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
import { db } from "./db/client";
import { videoStream, alert } from "./db/schema";
import { eq, and } from "drizzle-orm";

// Generate unique ID for alerts
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

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
    const { streamId, clientType, produces = [], consumes = [] } = message;

    // Get authenticated user info from connection data (set during upgrade)
    const existingData = ws.data;
    if (!existingData?.userId) {
      this.sendError(ws, "AUTH_REQUIRED", "Connection not authenticated");
      return;
    }

    // Verify stream ownership if this is a mobile client (producer)
    if (clientType === "mobile" && produces.includes("video-frame")) {
      try {
        const stream = await db
          .select()
          .from(videoStream)
          .where(and(
            eq(videoStream.id, streamId),
            eq(videoStream.userId, existingData.userId)
          ))
          .limit(1);

        if (stream.length === 0) {
          this.sendError(ws, "UNAUTHORIZED", "Stream not found or you don't own this stream");
          return;
        }

        // Update stream status to online
        await db
          .update(videoStream)
          .set({ 
            status: "online",
            lastSeen: new Date()
          })
          .where(eq(videoStream.id, streamId));
      } catch (error) {
        console.error("[MessageRouter] Error verifying stream ownership:", error);
        this.sendError(ws, "SERVER_ERROR", "Failed to verify stream ownership");
        return;
      }
    }

    // For dashboard/ML subscribing to streams, verify user owns the stream
    if (clientType !== "ml-service" && consumes.includes("video-frame")) {
      try {
        const stream = await db
          .select()
          .from(videoStream)
          .where(and(
            eq(videoStream.id, streamId),
            eq(videoStream.userId, existingData.userId)
          ))
          .limit(1);

        if (stream.length === 0) {
          this.sendError(ws, "UNAUTHORIZED", "Stream not found or you don't own this stream");
          return;
        }
      } catch (error) {
        console.error("[MessageRouter] Error verifying stream access:", error);
        this.sendError(ws, "SERVER_ERROR", "Failed to verify stream access");
        return;
      }
    }

    // Create client metadata, preserving auth info from connection
    const metadata: ClientMetadata = {
      userId: existingData.userId,
      sessionId: existingData.sessionId,
      userEmail: existingData.userEmail,
      userName: existingData.userName,
      streamId,
      clientType,
      produces,
      consumes,
      connectedAt: existingData.connectedAt || new Date(),
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
      `[MessageRouter] Registered ${clientType} client (user: ${metadata.userEmail || metadata.userId}) for stream ${streamId} ` +
      `(produces: ${produces.join(", ")}, consumes: ${consumes.join(", ")})`
    );

    this.sendSuccess(ws, "Registration successful");

    // Broadcast status update and update DB if this is a mobile client starting to stream
    if (clientType === "mobile" && produces.includes("video-frame")) {
      this.broadcastStatus(streamId, "streaming");
      
      // Update stream status to streaming
      try {
        await db
          .update(videoStream)
          .set({ 
            status: "streaming",
            lastSeen: new Date()
          })
          .where(eq(videoStream.id, streamId));
      } catch (error) {
        console.error("[MessageRouter] Error updating stream status:", error);
      }
    }
  }

  /**
   * Handle subscription from a consumer (dashboard, ML service)
   */
  private async handleSubscribe(
    ws: ServerWebSocket<ClientMetadata>,
    message: SubscribeMessage
  ): Promise<void> {
    const { streamId, clientType, consumes } = message;

    // Get authenticated user info from connection data (set during upgrade)
    const existingData = ws.data;
    if (!existingData?.userId) {
      this.sendError(ws, "AUTH_REQUIRED", "Connection not authenticated");
      return;
    }

    // For dashboard/mobile subscribing to streams, verify user owns the stream
    // ML service is allowed to subscribe to any stream for analysis
    if (clientType !== "ml-service") {
      try {
        const stream = await db
          .select()
          .from(videoStream)
          .where(and(
            eq(videoStream.id, streamId),
            eq(videoStream.userId, existingData.userId)
          ))
          .limit(1);

        if (stream.length === 0) {
          this.sendError(ws, "UNAUTHORIZED", "Stream not found or you don't own this stream");
          return;
        }
      } catch (error) {
        console.error("[MessageRouter] Error verifying stream access:", error);
        this.sendError(ws, "SERVER_ERROR", "Failed to verify stream access");
        return;
      }
    }

    // Create client metadata, preserving auth info from connection
    const metadata: ClientMetadata = {
      userId: existingData.userId,
      sessionId: existingData.sessionId,
      userEmail: existingData.userEmail,
      userName: existingData.userName,
      streamId,
      clientType,
      produces: [],
      consumes,
      connectedAt: existingData.connectedAt || new Date(),
    };

    // Store metadata
    connectionManager.setMetadata(ws, metadata);

    // Register as consumer for each message type
    for (const type of consumes) {
      connectionManager.registerConsumer(streamId, ws, type);
    }

    console.log(
      `[MessageRouter] ${clientType} (user: ${metadata.userEmail || metadata.userId}) subscribed to stream ${streamId} ` +
      `(consumes: ${consumes.join(", ")})`
    );

    this.sendSuccess(ws, "Subscription successful");
  }

  /**
   * Handle video frame from mobile → broadcast to dashboard and ML service
   * Note: Video frames are broadcasted to ALL subscribers (dashboard, ML service, etc.)
   * The ML service should maintain a persistent WebSocket connection to ensure it receives all frames.
   */
  private async handleVideoFrame(
    ws: ServerWebSocket<ClientMetadata>,
    message: VideoFrameMessage
  ): Promise<void> {
    const { streamId } = message;

    // Get all video consumers for this stream
    const consumers = connectionManager.getConsumers(streamId, "video-frame");

    if (consumers.length === 0) {
      console.warn(
        `[MessageRouter] WARNING: No consumers for video stream ${streamId}. ` +
        `ML service should be connected to analyze footage. Frame will be dropped.`
      );
      return;
    }

    // Separate consumers by type for logging
    const dashboardConsumers = consumers.filter(c => c.data?.clientType === "dashboard");
    const mlConsumers = consumers.filter(c => c.data?.clientType === "ml-service");
    const mobileConsumers = consumers.filter(c => c.data?.clientType === "mobile");

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
      `[MessageRouter] Broadcast video frame for stream ${streamId} to ${successCount}/${consumers.length} consumers ` +
      `(dashboard: ${dashboardConsumers.length}, ML: ${mlConsumers.length}, mobile: ${mobileConsumers.length})`
    );

    // Log warning if ML service is not connected
    if (mlConsumers.length === 0) {
      console.warn(`[MessageRouter] WARNING: No ML service connected for stream ${streamId}. Footage is not being analyzed.`);
    }
  }

  /**
   * Handle alert from ML service → broadcast to mobile and dashboard
   */
  private async handleAlert(
    ws: ServerWebSocket<ClientMetadata>,
    message: AlertMessage
  ): Promise<void> {
    const { streamId, severity, message: alertMessage, metadata } = message;

    // Store alert in database
    try {
      const alertId = generateId("alert");
      await db.insert(alert).values({
        id: alertId,
        streamId,
        severity,
        message: alertMessage,
        metadata: metadata || null,
      });
      console.log(`[MessageRouter] Stored alert ${alertId} in database`);
    } catch (error) {
      console.error(`[MessageRouter] Failed to store alert in database:`, error);
      // Continue with broadcast even if storage fails
    }

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

      // If mobile producer disconnected, broadcast offline status and update database
      if (metadata.clientType === "mobile" && metadata.produces.includes("video-frame")) {
        this.broadcastStatus(metadata.streamId, "offline");
        
        // Update database with offline status and lastSeen
        try {
          await db
            .update(videoStream)
            .set({ 
              status: "offline",
              lastSeen: new Date()
            })
            .where(eq(videoStream.id, metadata.streamId));
          console.log(`[MessageRouter] Updated stream ${metadata.streamId} status to offline`);
        } catch (error) {
          console.error(`[MessageRouter] Failed to update stream status on disconnect:`, error);
        }
      }
    }
  }
}

// Singleton instance
export const messageRouter = new MessageRouter();
