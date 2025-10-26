import type { ServerWebSocket } from "bun";
import type { ClientMetadata, WSMessage } from "./types";
import { messageRouter } from "./message-router";
import { connectionManager } from "./connection-manager";
import { extractTokenFromRequest, verifySessionToken } from "./auth";

const PORT = process.env.PORT || 3000;

/**
 * WebSocket Server using Bun's native APIs
 *
 * This server is a pure stream router that:
 * - Accepts mobile clients at /streams/register (WebSocket upgrade)
 * - Accepts web app subscribers at /streams/subscribe (WebSocket upgrade)
 * - Routes video frames from mobile → web app + ML service
 * - Routes alerts from ML service → mobile + web app
 * 
 * All stream data is kept in memory only. No persistence.
 */
const server = Bun.serve<ClientMetadata>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // /streams/register - Mobile client WebSocket connection
    if (url.pathname === "/streams/register") {
      // Allow unauthenticated connection - auth happens via first message
      const upgraded = server.upgrade(req, {
        data: {
          streamId: "", // Will be set during registration message
          clientType: "mobile" as const,
          produces: [],
          consumes: [],
          connectedAt: new Date(),
          authenticated: false, // Not authenticated yet
        } as ClientMetadata,
      });

      if (upgraded) {
        console.log("[Register] Mobile client connected - awaiting authentication");
        return undefined; // Return undefined when upgrade is successful
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // /streams/subscribe - Web app subscriber WebSocket connection
    if (url.pathname === "/streams/subscribe") {
      // Allow unauthenticated connection - auth happens via first message
      const upgraded = server.upgrade(req, {
        data: {
          streamId: "", // Will be set during subscription message
          clientType: "dashboard" as const,
          produces: [],
          consumes: [],
          connectedAt: new Date(),
          authenticated: false, // Not authenticated yet
        } as ClientMetadata,
      });

      if (upgraded) {
        console.log("[Subscribe] Web app subscriber connected - awaiting authentication");
        return undefined;
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
    return new Response(
      "Watchout Stream Router\n\nEndpoints:\n- /streams/register - Mobile client WebSocket endpoint\n- /streams/subscribe - Web app subscriber WebSocket endpoint\n- /health - Health check\n- /stats - Connection statistics",
      {
        headers: { "Content-Type": "text/plain" },
      },
    );
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
          console.log(
            "[WebSocket] Received binary message (not yet supported)",
          );
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
        ws.send(
          JSON.stringify({
            type: "error",
            code: "INVALID_MESSAGE",
            message: "Failed to process message",
            timestamp: Date.now(),
          }),
        );
      }
    },

    /**
     * Called when a client disconnects
     */
    async close(ws, code, reason) {
      console.log(
        `[WebSocket] Client disconnected (code: ${code}, reason: ${reason})`,
      );
      await messageRouter.handleDisconnect(ws);
    },

    // Bun WebSocket options
    perMessageDeflate: true, // Enable compression
    maxPayloadLength: 16 * 1024 * 1024, // 16MB max payload (for video frames)
    idleTimeout: 120, // 2 minutes idle timeout
    backpressureLimit: 1024 * 1024, // 1MB backpressure limit
  },
});

console.log(
  `🚀 Watchout Stream Router running on port ${PORT}`,
);
console.log(`📱 Mobile clients: ws://localhost:${PORT}/streams/register`);
console.log(`🖥️  Web app: ws://localhost:${PORT}/streams/subscribe`);
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
