import type { ServerWebSocket } from "bun";
import type { ClientMetadata, MessageType } from "./types";

/**
 * Connection Manager
 * 
 * In-memory tracker for all active WebSocket connections.
 * No persistence - all state is kept in memory only.
 * 
 * Provides methods to:
 * - Register producers (mobile streaming video)
 * - Register consumers (web app viewing video/alerts, ML analyzing video)
 * - Route messages to appropriate consumers
 * - Clean up on disconnect
 */
export class ConnectionManager {
  // Map streamId → WebSocket connection from mobile producing video
  private videoProducers: Map<string, ServerWebSocket<ClientMetadata>>;

  // Map streamId → array of WebSocket connections consuming video (dashboard, ML)
  private videoConsumers: Map<string, Set<ServerWebSocket<ClientMetadata>>>;

  // Map streamId → array of WebSocket connections consuming alerts (mobile, dashboard)
  private alertConsumers: Map<string, Set<ServerWebSocket<ClientMetadata>>>;

  // Map WebSocket → client metadata
  private connectionMetadata: Map<ServerWebSocket<ClientMetadata>, ClientMetadata>;

  constructor() {
    this.videoProducers = new Map();
    this.videoConsumers = new Map();
    this.alertConsumers = new Map();
    this.connectionMetadata = new Map();
  }

  /**
   * Register a producer for a specific message type
   */
  registerProducer(
    streamId: string,
    ws: ServerWebSocket<ClientMetadata>,
    type: MessageType
  ): void {
    if (type === "video-frame") {
      this.videoProducers.set(streamId, ws);
      console.log(`[ConnectionManager] Registered video producer for stream: ${streamId}`);
    }
    // Note: alerts can come from ML service, but we don't track them as "producers"
    // since multiple ML services could send alerts for the same stream
  }

  /**
   * Register a consumer for a specific message type
   */
  registerConsumer(
    streamId: string,
    ws: ServerWebSocket<ClientMetadata>,
    type: MessageType
  ): void {
    if (type === "video-frame") {
      if (!this.videoConsumers.has(streamId)) {
        this.videoConsumers.set(streamId, new Set());
      }
      this.videoConsumers.get(streamId)!.add(ws);
      console.log(`[ConnectionManager] Registered video consumer for stream: ${streamId}`);
    } else if (type === "alert") {
      if (!this.alertConsumers.has(streamId)) {
        this.alertConsumers.set(streamId, new Set());
      }
      this.alertConsumers.get(streamId)!.add(ws);
      console.log(`[ConnectionManager] Registered alert consumer for stream: ${streamId}`);
    }
  }

  /**
   * Store metadata for a connection
   */
  setMetadata(ws: ServerWebSocket<ClientMetadata>, metadata: ClientMetadata): void {
    this.connectionMetadata.set(ws, metadata);
    ws.data = metadata; // Also store in Bun's built-in data property
  }

  /**
   * Get metadata for a connection
   */
  getMetadata(ws: ServerWebSocket<ClientMetadata>): ClientMetadata | undefined {
    return this.connectionMetadata.get(ws) || ws.data;
  }

  /**
   * Get all consumers for a specific stream and message type
   */
  getConsumers(streamId: string, type: MessageType): ServerWebSocket<ClientMetadata>[] {
    if (type === "video-frame") {
      return Array.from(this.videoConsumers.get(streamId) || []);
    } else if (type === "alert") {
      return Array.from(this.alertConsumers.get(streamId) || []);
    }
    return [];
  }

  /**
   * Get producer for a specific stream and message type
   */
  getProducer(streamId: string, type: MessageType): ServerWebSocket<ClientMetadata> | null {
    if (type === "video-frame") {
      return this.videoProducers.get(streamId) || null;
    }
    return null;
  }

  /**
   * Remove a connection and clean up all references
   */
  removeConnection(ws: ServerWebSocket<ClientMetadata>): ClientMetadata | undefined {
    const metadata = this.getMetadata(ws);
    
    if (!metadata) {
      return undefined;
    }

    const { streamId, produces, consumes } = metadata;

    // Remove from producers
    if (produces.includes("video-frame")) {
      if (this.videoProducers.get(streamId) === ws) {
        this.videoProducers.delete(streamId);
        console.log(`[ConnectionManager] Removed video producer for stream: ${streamId}`);
      }
    }

    // Remove from consumers
    if (consumes.includes("video-frame")) {
      const consumers = this.videoConsumers.get(streamId);
      if (consumers) {
        consumers.delete(ws);
        if (consumers.size === 0) {
          this.videoConsumers.delete(streamId);
        }
      }
    }

    if (consumes.includes("alert")) {
      const consumers = this.alertConsumers.get(streamId);
      if (consumers) {
        consumers.delete(ws);
        if (consumers.size === 0) {
          this.alertConsumers.delete(streamId);
        }
      }
    }

    // Remove metadata
    this.connectionMetadata.delete(ws);

    console.log(`[ConnectionManager] Removed connection for stream: ${streamId}`);
    return metadata;
  }

  /**
   * Get all active stream IDs
   */
  getActiveStreams(): string[] {
    return Array.from(this.videoProducers.keys());
  }

  /**
   * Get connection count for a stream
   */
  getConnectionCount(streamId: string): {
    videoConsumers: number;
    alertConsumers: number;
    hasProducer: boolean;
  } {
    return {
      videoConsumers: this.videoConsumers.get(streamId)?.size || 0,
      alertConsumers: this.alertConsumers.get(streamId)?.size || 0,
      hasProducer: this.videoProducers.has(streamId),
    };
  }

  /**
   * Get total connection statistics
   */
  getStats() {
    return {
      totalProducers: this.videoProducers.size,
      totalVideoConsumers: Array.from(this.videoConsumers.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      totalAlertConsumers: Array.from(this.alertConsumers.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      totalConnections: this.connectionMetadata.size,
      activeStreams: this.getActiveStreams(),
    };
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();
