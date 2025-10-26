import type { ServerWebSocket } from "bun";
import type { ClientMetadata, WSMessage } from "./types";
import { messageRouter } from "./message-router";
import { connectionManager } from "./connection-manager";
import { extractTokenFromRequest, verifySessionToken } from "./auth";
import { db } from "./db/client";
import { videoStream, alert } from "./db/schema";
import { eq, and, desc } from "drizzle-orm";

const PORT = process.env.PORT || 3000;

// Generate unique ID for streams and alerts
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

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
      // Extract and verify authentication token
      const token = extractTokenFromRequest(req);
      
      if (!token) {
        console.log("[WebSocket] Connection rejected: No authentication token");
        return new Response("Authentication required", { status: 401 });
      }

      // Verify the session
      const session = await verifySessionToken(token);
      
      if (!session) {
        console.log("[WebSocket] Connection rejected: Invalid or expired token");
        return new Response("Invalid or expired authentication token", { status: 401 });
      }

      console.log(`[WebSocket] Authenticated connection for user: ${session.user.email || session.userId}`);

      // Store session info in data to be used in the websocket handlers
      // @ts-ignore - Bun's upgrade can work with just req in some cases
      const upgraded = server.upgrade(req, {
        data: {
          userId: session.userId,
          sessionId: session.sessionId,
          userEmail: session.user.email,
          userName: session.user.name,
          // These will be set during registration/subscription
          streamId: "",
          clientType: "mobile" as const,
          produces: [],
          consumes: [],
          connectedAt: new Date(),
        } as ClientMetadata,
      });

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

    // POST /streams/register - Register a new video stream
    if (url.pathname === "/streams/register" && req.method === "POST") {
      // Extract and verify authentication token
      const token = extractTokenFromRequest(req);
      
      if (!token) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
      }

      const session = await verifySessionToken(token);
      
      if (!session) {
        return Response.json({ error: "Invalid or expired authentication token" }, { status: 401 });
      }

      try {
        const body = await req.json();
        const { deviceName, deviceType, metadata } = body;

        if (!deviceName || !deviceType) {
          return Response.json({ error: "deviceName and deviceType are required" }, { status: 400 });
        }

        // Generate unique stream ID
        const streamId = generateId("stream");

        // Insert into database
        await db.insert(videoStream).values({
          id: streamId,
          userId: session.userId,
          deviceName,
          deviceType,
          status: "offline",
          metadata: metadata || null,
        });

        console.log(`[REST] Registered new stream ${streamId} for user ${session.userId}`);

        return Response.json({
          streamId,
          message: "Stream registered successfully",
        });
      } catch (error) {
        console.error("[REST] Error registering stream:", error);
        return Response.json({ error: "Failed to register stream" }, { status: 500 });
      }
    }

    // GET /streams - List all streams for authenticated user
    if (url.pathname === "/streams" && req.method === "GET") {
      // Extract and verify authentication token
      const token = extractTokenFromRequest(req);
      
      if (!token) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
      }

      const session = await verifySessionToken(token);
      
      if (!session) {
        return Response.json({ error: "Invalid or expired authentication token" }, { status: 401 });
      }

      try {
        // Get all streams for this user
        const streams = await db
          .select()
          .from(videoStream)
          .where(eq(videoStream.userId, session.userId))
          .orderBy(desc(videoStream.createdAt));

        console.log(`[REST] Listed ${streams.length} streams for user ${session.userId}`);

        return Response.json({ streams });
      } catch (error) {
        console.error("[REST] Error listing streams:", error);
        return Response.json({ error: "Failed to list streams" }, { status: 500 });
      }
    }

    // GET /alerts - Get alert history for a stream
    if (url.pathname === "/alerts" && req.method === "GET") {
      // Extract and verify authentication token
      const token = extractTokenFromRequest(req);
      
      if (!token) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
      }

      const session = await verifySessionToken(token);
      
      if (!session) {
        return Response.json({ error: "Invalid or expired authentication token" }, { status: 401 });
      }

      try {
        const streamId = url.searchParams.get("streamId");
        const limitStr = url.searchParams.get("limit") || "50";
        const limit = parseInt(limitStr, 10);

        if (!streamId) {
          return Response.json({ error: "streamId query parameter is required" }, { status: 400 });
        }

        // Verify user owns this stream
        const stream = await db
          .select()
          .from(videoStream)
          .where(and(
            eq(videoStream.id, streamId),
            eq(videoStream.userId, session.userId)
          ))
          .limit(1);

        if (stream.length === 0) {
          return Response.json({ error: "Stream not found or unauthorized" }, { status: 404 });
        }

        // Get alerts for this stream
        const alerts = await db
          .select()
          .from(alert)
          .where(eq(alert.streamId, streamId))
          .orderBy(desc(alert.createdAt))
          .limit(limit);

        console.log(`[REST] Retrieved ${alerts.length} alerts for stream ${streamId}`);

        return Response.json({ alerts });
      } catch (error) {
        console.error("[REST] Error retrieving alerts:", error);
        return Response.json({ error: "Failed to retrieve alerts" }, { status: 500 });
      }
    }

    // Default response
    return new Response(
      "Watchout WebSocket Server\n\nEndpoints:\n- /ws - WebSocket endpoint\n- /health - Health check\n- /stats - Connection statistics\n- POST /streams/register - Register a stream\n- GET /streams - List streams\n- GET /alerts?streamId=xxx - Get alert history",
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
  `🚀 Watchout WebSocket Server running on ws://localhost:${PORT}/ws`,
);
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
