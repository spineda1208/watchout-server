import type { ServerWebSocket } from "bun";
import type {
  ClientMetadata,
  WSMessage,
  RegisterMessage,
  SubscribeMessage,
  VideoFrameMessage,
  AlertMessage,
  ErrorMessage,
  SuccessMessage,
} from "./types";
import { connectionManager } from "./connection-manager";

/**
 * Message Router
 * 
 * Routes incoming WebSocket messages to appropriate consumers based on message type
 */
export class MessageRouter {
  /**
   * Route an incoming message to appropriate consumers
   */
  async routeMessage(
    ws: ServerWebSocket<ClientMetadata>,
    message: WSMessage
  ): Promise<void> {
    try {
      switch (message.type) {
        case "register":
          await this.handleRegister(ws, message);
          break;

        case "subscribe":
          await this.handleSubscribe(ws, message);
          break;

        case "video-frame":
          await this.handleVideoFrame(ws, message);
          break;

        case "alert":
          await this.handleAlert(ws, message);
          break;

        case "auth":
          // TODO: Implement authentication
          this.sendSuccess(ws, "Authentication successful");
          break;

        default:
          this.sendError(ws, "UNKNOWN_MESSAGE_TYPE", `Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      console.error("[MessageRouter] Error routing message:", error);
      this.sendError(ws, "ROUTING_ERROR", "Failed to route message");
    }
  }

  /**
   * Handle registration from a producer (mobile streaming video)
   */
  private async handleRegister(
    ws: ServerWebSocket<ClientMetadata>,
    message: RegisterMessage
  ): Promise<void> {
    const { streamId, clientType, produces = [], consumes = [], userId } = message;

    // Create client metadata
    const metadata: ClientMetadata = {
      userId,
      streamId,
      clientType,
      produces,
      consumes,
      connectedAt: new Date(),
    };

    // Store metadata
    connectionManager.setMetadata(ws, metadata);

    // Register as producer for each message type it produces
    for (const type of produces) {
      connectionManager.registerProducer(streamId, ws, type);
    }

    // Register as consumer for each message type it consumes
    for (const type of consumes) {
      connectionManager.registerConsumer(streamId, ws, type);
    }

    console.log(
      `[MessageRouter] Registered ${clientType} client for stream ${streamId} ` +
      `(produces: ${produces.join(", ")}, consumes: ${consumes.join(", ")})`
    );

    this.sendSuccess(ws, "Registration successful");

    // Broadcast status update if this is a mobile client starting to stream
    if (clientType === "mobile" && produces.includes("video-frame")) {
      this.broadcastStatus(streamId, "streaming");
    }
  }

  /**
   * Handle subscription from a consumer (dashboard, ML service)
   */
  private async handleSubscribe(
    ws: ServerWebSocket<ClientMetadata>,
    message: SubscribeMessage
  ): Promise<void> {
    const { streamId, clientType, consumes, userId } = message;

    // Create client metadata
    const metadata: ClientMetadata = {
      userId,
      streamId,
      clientType,
      produces: [],
      consumes,
      connectedAt: new Date(),
    };

    // Store metadata
    connectionManager.setMetadata(ws, metadata);

    // Register as consumer for each message type
    for (const type of consumes) {
      connectionManager.registerConsumer(streamId, ws, type);
    }

    console.log(
      `[MessageRouter] ${clientType} subscribed to stream ${streamId} ` +
      `(consumes: ${consumes.join(", ")})`
    );

    this.sendSuccess(ws, "Subscription successful");
  }

  /**
   * Handle video frame from mobile → broadcast to dashboard and ML service
   */
  private async handleVideoFrame(
    ws: ServerWebSocket<ClientMetadata>,
    message: VideoFrameMessage
  ): Promise<void> {
    const { streamId } = message;

    // Get all video consumers for this stream
    const consumers = connectionManager.getConsumers(streamId, "video-frame");

    if (consumers.length === 0) {
      console.log(`[MessageRouter] No consumers for video stream ${streamId}`);
      return;
    }

    // Broadcast to all consumers
    const messageStr = JSON.stringify(message);
    let successCount = 0;

    for (const consumer of consumers) {
      try {
        consumer.send(messageStr);
        successCount++;
      } catch (error) {
        console.error(`[MessageRouter] Failed to send video frame to consumer:`, error);
      }
    }

    console.log(
      `[MessageRouter] Broadcast video frame for stream ${streamId} to ${successCount}/${consumers.length} consumers`
    );
  }

  /**
   * Handle alert from ML service → broadcast to mobile and dashboard
   */
  private async handleAlert(
    ws: ServerWebSocket<ClientMetadata>,
    message: AlertMessage
  ): Promise<void> {
    const { streamId, severity, message: alertMessage } = message;

    // Get all alert consumers for this stream
    const consumers = connectionManager.getConsumers(streamId, "alert");

    if (consumers.length === 0) {
      console.log(`[MessageRouter] No consumers for alerts on stream ${streamId}`);
      return;
    }

    // Broadcast to all consumers
    const messageStr = JSON.stringify(message);
    let successCount = 0;

    for (const consumer of consumers) {
      try {
        consumer.send(messageStr);
        successCount++;
      } catch (error) {
        console.error(`[MessageRouter] Failed to send alert to consumer:`, error);
      }
    }

    console.log(
      `[MessageRouter] Broadcast ${severity} alert for stream ${streamId} to ${successCount}/${consumers.length} consumers: ${alertMessage}`
    );

    // TODO: Store alert in database
  }

  /**
   * Broadcast status update to all consumers of a stream
   */
  private broadcastStatus(
    streamId: string,
    status: "online" | "offline" | "streaming"
  ): void {
    const statusMessage = {
      type: "status",
      streamId,
      status,
      timestamp: Date.now(),
    };

    const messageStr = JSON.stringify(statusMessage);

    // Broadcast to both video and alert consumers
    const allConsumers = [
      ...connectionManager.getConsumers(streamId, "video-frame"),
      ...connectionManager.getConsumers(streamId, "alert"),
    ];

    for (const consumer of allConsumers) {
      try {
        consumer.send(messageStr);
      } catch (error) {
        console.error(`[MessageRouter] Failed to send status update:`, error);
      }
    }

    console.log(`[MessageRouter] Broadcast status '${status}' for stream ${streamId}`);
  }

  /**
   * Send error message to client
   */
  private sendError(ws: ServerWebSocket<ClientMetadata>, code: string, message: string): void {
    const errorMessage: ErrorMessage = {
      type: "error",
      code,
      message,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(errorMessage));
  }

  /**
   * Send success message to client
   */
  private sendSuccess(ws: ServerWebSocket<ClientMetadata>, message: string): void {
    const successMessage: SuccessMessage = {
      type: "success",
      message,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(successMessage));
  }

  /**
   * Handle client disconnect
   */
  async handleDisconnect(ws: ServerWebSocket<ClientMetadata>): Promise<void> {
    const metadata = connectionManager.removeConnection(ws);

    if (metadata) {
      console.log(
        `[MessageRouter] Client disconnected: ${metadata.clientType} from stream ${metadata.streamId}`
      );

      // If mobile producer disconnected, broadcast offline status
      if (metadata.clientType === "mobile" && metadata.produces.includes("video-frame")) {
        this.broadcastStatus(metadata.streamId, "offline");
      }

      // TODO: Update database with lastSeen timestamp
    }
  }
}

// Singleton instance
export const messageRouter = new MessageRouter();
