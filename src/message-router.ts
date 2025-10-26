import type { ServerWebSocket } from "bun";
import type {
  ClientMetadata,
  WSMessage,
  RegisterMessage,
  SubscribeMessage,
  VideoFrameMessage,
  AlertMessage,
  AuthMessage,
  ErrorMessage,
  SuccessMessage,
} from "./types";
import { connectionManager } from "./connection-manager";
import { verifySessionToken } from "./auth";

/**
 * Message Router
 * 
 * Pure stream router - manages in-memory connections and routes messages.
 * No database persistence - all state is in memory.
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
        case "auth":
          await this.handleAuth(ws, message);
          break;

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

        default:
          this.sendError(ws, "UNKNOWN_MESSAGE_TYPE", `Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      console.error("[MessageRouter] Error routing message:", error);
      this.sendError(ws, "ROUTING_ERROR", "Failed to route message");
    }
  }

  /**
   * Handle authentication message - MUST be first message from client
   */
  private async handleAuth(
    ws: ServerWebSocket<ClientMetadata>,
    message: AuthMessage
  ): Promise<void> {
    // Check if already authenticated
    if (ws.data.authenticated) {
      this.sendError(ws, "ALREADY_AUTHENTICATED", "Connection already authenticated");
      return;
    }

    // Verify the session token
    const session = await verifySessionToken(message.token);
    
    if (!session) {
      console.log("[Auth] Invalid or expired token");
      this.sendError(ws, "AUTH_FAILED", "Invalid or expired authentication token");
      ws.close(1008, "Authentication failed"); // Policy violation close code
      return;
    }

    // Update connection metadata with authenticated user info
    ws.data.userId = session.userId;
    ws.data.sessionId = session.sessionId;
    ws.data.userEmail = session.user.email;
    ws.data.userName = session.user.name;
    ws.data.authenticated = true;

    console.log(`[Auth] Client authenticated: ${session.user.email || session.userId}`);
    this.sendSuccess(ws, "Authentication successful");
  }

  /**
   * Handle registration from a mobile client (producer)
   * Mobile clients connect via /streams/register and then send this message
   */
  private async handleRegister(
    ws: ServerWebSocket<ClientMetadata>,
    message: RegisterMessage
  ): Promise<void> {
    // Require authentication before registration
    if (!ws.data.authenticated) {
      this.sendError(ws, "AUTH_REQUIRED", "Must authenticate first. Send auth message with token.");
      return;
    }

    const { streamId, clientType, produces = [], consumes = [] } = message;

    // Get authenticated user info from connection data
    const existingData = ws.data;
    if (!existingData?.userId) {
      this.sendError(ws, "AUTH_REQUIRED", "Connection not authenticated");
      return;
    }

    // Generate stream ID if not provided
    const finalStreamId = streamId || `stream_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Create client metadata, preserving auth info from connection
    const metadata: ClientMetadata = {
      userId: existingData.userId,
      sessionId: existingData.sessionId,
      userEmail: existingData.userEmail,
      userName: existingData.userName,
      streamId: finalStreamId,
      clientType,
      produces,
      consumes,
      connectedAt: existingData.connectedAt || new Date(),
      authenticated: existingData.authenticated,
    };

    // Store metadata
    connectionManager.setMetadata(ws, metadata);

    // Register as producer for each message type it produces
    for (const type of produces) {
      connectionManager.registerProducer(finalStreamId, ws, type);
    }

    // Register as consumer for each message type it consumes
    for (const type of consumes) {
      connectionManager.registerConsumer(finalStreamId, ws, type);
    }

    console.log(
      `[MessageRouter] Registered ${clientType} client (user: ${metadata.userEmail || metadata.userId}) for stream ${finalStreamId} ` +
      `(produces: ${produces.join(", ")}, consumes: ${consumes.join(", ")})`
    );

    this.sendSuccess(ws, `Registration successful. Stream ID: ${finalStreamId}`);

    // Broadcast status update if this is a mobile client starting to stream
    if (clientType === "mobile" && produces.includes("video-frame")) {
      this.broadcastStatus(finalStreamId, "streaming");
    }
  }

  /**
   * Handle subscription from a consumer (web app, ML service)
   * Subscribers connect via /streams/subscribe and then send this message
   */
  private async handleSubscribe(
    ws: ServerWebSocket<ClientMetadata>,
    message: SubscribeMessage
  ): Promise<void> {
    // Require authentication before subscription
    if (!ws.data.authenticated) {
      this.sendError(ws, "AUTH_REQUIRED", "Must authenticate first. Send auth message with token.");
      return;
    }

    const { streamId, clientType, consumes } = message;

    // Get authenticated user info from connection data
    const existingData = ws.data;
    if (!existingData?.userId) {
      this.sendError(ws, "AUTH_REQUIRED", "Connection not authenticated");
      return;
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
      authenticated: existingData.authenticated,
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
   * Handle video frame from mobile → broadcast to web app subscribers + forward to ML service
   * 
   * Flow:
   * 1. Mobile sends video frame to us
   * 2. We broadcast to all web app subscribers (WebSocket)
   * 3. We forward to ML service (WE initiate connection/HTTP POST)
   * 4. ML service analyzes and sends alerts back to us
   * 5. We broadcast alerts to mobile + web app subscribers
   */
  private async handleVideoFrame(
    ws: ServerWebSocket<ClientMetadata>,
    message: VideoFrameMessage
  ): Promise<void> {
    // Require authentication
    if (!ws.data.authenticated) {
      this.sendError(ws, "AUTH_REQUIRED", "Must authenticate first");
      return;
    }

    const { streamId } = message;

    // Get all video consumers for this stream (web app only)
    const consumers = connectionManager.getConsumers(streamId, "video-frame");

    // Broadcast to WebSocket subscribers (web app)
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
      `[MessageRouter] Broadcast video frame for stream ${streamId} to ${successCount} web app subscriber(s)`
    );

    // TODO: Forward to ML service (WE initiate, not ML service)
    // The ML service does NOT connect to us - we push frames to it
    // 
    // Option 1: HTTP POST to ML service endpoint
    // const mlServiceUrl = process.env.ML_SERVICE_URL;
    // if (mlServiceUrl) {
    //   try {
    //     await fetch(`${mlServiceUrl}/analyze`, {
    //       method: 'POST',
    //       headers: { 'Content-Type': 'application/json' },
    //       body: JSON.stringify({
    //         streamId: message.streamId,
    //         frame: message.data,
    //         timestamp: message.timestamp
    //       })
    //     });
    //   } catch (error) {
    //     console.error('[MessageRouter] Failed to forward to ML service:', error);
    //   }
    // }
    //
    // Option 2: WebSocket client (we connect TO ML service)
    // - Maintain persistent WebSocket connection to ML service
    // - Forward frames through that connection
    // - Receive alerts back through same connection
    //
    // Option 3: Message Queue (Redis/RabbitMQ)
    // - Publish frames to queue
    // - ML service consumes from queue
    // - ML service publishes alerts to another queue
    // - We consume alerts and broadcast to clients
  }

  /**
   * Handle alert from ML service → broadcast to mobile and web app
   * 
   * Note: 
   * - ML service sends alerts back to us (via HTTP callback or WebSocket we initiated)
   * - This handler receives those alerts and broadcasts to clients
   * - Alert persistence is handled by another service/codebase
   * - This server only routes alerts in real-time
   * 
   * TODO: Set up endpoint/mechanism for ML service to send alerts back to us
   * Options:
   * 1. POST /alerts endpoint - ML service POSTs alerts to us
   * 2. WebSocket connection TO ML service - receive alerts on same connection
   * 3. Message Queue - consume alerts from queue
   */
  private async handleAlert(
    ws: ServerWebSocket<ClientMetadata>,
    message: AlertMessage
  ): Promise<void> {
    // Require authentication
    if (!ws.data.authenticated) {
      this.sendError(ws, "AUTH_REQUIRED", "Must authenticate first");
      return;
    }

    const { streamId, severity, message: alertMessage } = message;

    // Get all alert consumers for this stream (mobile + web app)
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
      `[MessageRouter] Broadcast ${severity} alert for stream ${streamId} to ${successCount} consumer(s): ${alertMessage}`
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

      // If mobile producer disconnected, broadcast offline status
      if (metadata.clientType === "mobile" && metadata.produces.includes("video-frame")) {
        this.broadcastStatus(metadata.streamId, "offline");
      }
    }
  }
}

// Singleton instance
export const messageRouter = new MessageRouter();
