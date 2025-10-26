import type { ServerWebSocket } from "bun";
import type { ClientMetadata, WSMessage } from "./types";
import { messageRouter } from "./message-router";
import { connectionManager } from "./connection-manager";

const PORT = process.env.PORT || 3000;

/**
 * WebSocket Server using Bun's native APIs
 * 
 * This server handles:
 * - Video streaming from mobile devices
 * - Video consumption by dashboard and ML services
 * - Alert broadcasting from ML services to mobile and dashboard
 */
const server = Bun.serve<ClientMetadata>({
  port: PORT,
  
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade endpoint
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) {
        return undefined; // Return undefined when upgrade is successful
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      const stats = connectionManager.getStats();
      return Response.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        stats,
      });
    }

    // Stats endpoint
    if (url.pathname === "/stats") {
      const stats = connectionManager.getStats();
      return Response.json(stats);
    }

    // Default response
    return new Response("Watchout WebSocket Server\n\nEndpoints:\n- /ws - WebSocket endpoint\n- /health - Health check\n- /stats - Connection statistics", {
      headers: { "Content-Type": "text/plain" },
    });
  },

  websocket: {
    /**
     * Called when a client connects
     */
    open(ws) {
      console.log(`[WebSocket] Client connected`);
    },

    /**
     * Called when a message is received from a client
     */
    async message(ws, message) {
      try {
        // Parse message
        let parsedMessage: WSMessage;
        
        if (typeof message === "string") {
          parsedMessage = JSON.parse(message);
        } else {
          // Handle binary messages (for future use with binary video frames)
          console.log("[WebSocket] Received binary message (not yet supported)");
          return;
        }

        // Add timestamp if not present
        if (!parsedMessage.timestamp) {
          parsedMessage.timestamp = Date.now();
        }

        console.log(`[WebSocket] Received message type: ${parsedMessage.type}`);

        // Route the message
        await messageRouter.routeMessage(ws, parsedMessage);
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        ws.send(JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Failed to process message",
          timestamp: Date.now(),
        }));
      }
    },

    /**
     * Called when a client disconnects
     */
    async close(ws, code, reason) {
      console.log(`[WebSocket] Client disconnected (code: ${code}, reason: ${reason})`);
      await messageRouter.handleDisconnect(ws);
    },

    /**
     * Called when an error occurs
     */
    error(ws, error) {
      console.error("[WebSocket] Error:", error);
    },

    // Bun WebSocket options
    perMessageDeflate: true, // Enable compression
    maxPayloadLength: 16 * 1024 * 1024, // 16MB max payload (for video frames)
    idleTimeout: 120, // 2 minutes idle timeout
    backpressureLimit: 1024 * 1024, // 1MB backpressure limit
  },
});

console.log(`🚀 Watchout WebSocket Server running on ws://localhost:${PORT}/ws`);
console.log(`📊 Health check: http://localhost:${PORT}/health`);
console.log(`📈 Stats: http://localhost:${PORT}/stats`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down server...");
  server.stop();
  process.exit(0);
});