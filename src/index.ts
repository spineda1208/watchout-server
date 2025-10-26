import type { ServerWebSocket } from "bun";
import type { ClientMetadata, WSMessage } from "./types";
import { messageRouter } from "./message-router";
import { connectionManager } from "./connection-manager";
import { extractTokenFromRequest, verifySessionToken } from "./auth";
import { metricsTracker } from "./metrics";

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
      const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
      const userAgent = req.headers.get("user-agent") || "unknown";
      
      console.log(`\n [Connection] New mobile client connecting`);
      console.log(`    IP: ${clientIp}`);
      console.log(`   User-Agent: ${userAgent}`);
      console.log(`    Time: ${new Date().toISOString()}`);
      
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
        console.log(`   [SUCCESS] WebSocket upgraded - awaiting authentication\n`);
        return undefined; // Return undefined when upgrade is successful
      }
      console.log(`   [ERROR] WebSocket upgrade failed\n`);
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // /streams/subscribe - Web app subscriber WebSocket connection
    if (url.pathname === "/streams/subscribe") {
      const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
      const userAgent = req.headers.get("user-agent") || "unknown";
      
      console.log(`\n [Connection] New dashboard/subscriber connecting`);
      console.log(`    IP: ${clientIp}`);
      console.log(`   User-Agent: ${userAgent}`);
      console.log(`    Time: ${new Date().toISOString()}`);
      
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
        console.log(`   [SUCCESS] WebSocket upgraded - awaiting authentication\n`);
        return undefined;
      }
      console.log(`   [ERROR] WebSocket upgrade failed\n`);
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      const stats = connectionManager.getStats();
      const metrics = Array.from(metricsTracker.getAllMetrics().values());
      return Response.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        stats,
        metrics: metrics.map(m => ({
          streamId: m.streamId,
          fps: m.fps,
          totalFrames: m.frameCount,
          uptime: Math.round((Date.now() - m.startTime) / 1000),
        })),
      });
    }

    // Stats endpoint
    if (url.pathname === "/stats") {
      const stats = connectionManager.getStats();
      const metrics = Array.from(metricsTracker.getAllMetrics().values());
      return Response.json({
        ...stats,
        streams: metrics.map(m => ({
          streamId: m.streamId,
          fps: m.fps,
          totalFrames: m.frameCount,
          uptime: Math.round((Date.now() - m.startTime) / 1000),
        })),
      });
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
      const clientType = ws.data.clientType;
      console.log(` [WebSocket] ${clientType} client WebSocket opened`);
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

        // Log message with context
        const userInfo = ws.data.authenticated 
          ? `${ws.data.userEmail || ws.data.userId}` 
          : "unauthenticated";
        
        console.log(` [Message] ${parsedMessage.type} from ${ws.data.clientType} (${userInfo})`);

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
      const userInfo = ws.data.authenticated 
        ? `${ws.data.userEmail || ws.data.userId}` 
        : "unauthenticated";
      const duration = Math.round((Date.now() - ws.data.connectedAt.getTime()) / 1000);
      
      console.log(`\n [Disconnect] ${ws.data.clientType} client disconnected`);
      console.log(`    User: ${userInfo}`);
      console.log(`   Duration: ${duration}s`);
      console.log(`    Code: ${code}, Reason: ${reason || 'none'}\n`);
      
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
  ` Watchout Stream Router running on port ${PORT}`,
);
console.log(` Mobile clients: ws://localhost:${PORT}/streams/register`);
console.log(`Web app: ws://localhost:${PORT}/streams/subscribe`);
console.log(` Health check: http://localhost:${PORT}/health`);
console.log(` Stats: http://localhost:${PORT}/stats`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down server...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Server] Shutting down server...");
  server.stop();
  process.exit(0);
});
