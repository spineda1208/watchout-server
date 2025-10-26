# Watchout Stream Router API

## Overview

This is a **pure stream router** - it manages WebSocket connections in memory and routes video/alert data between clients.

**Key Points:**

- ✅ All stream state is kept **in memory only** (no database persistence)
- ✅ Authentication via Better Auth (session verification only)
- ✅ Separate WebSocket endpoints for mobile and web app
- ✅ Automatic ML service forwarding (TODO - endpoint not yet configured)
- ❌ No REST API for streams
- ❌ No alert persistence (handled by another codebase)

---

## Architecture

```
Mobile Client              Web App
     ↓                        ↓
/streams/register      /streams/subscribe
     ↓                        ↓
     └────────────────────────┘
                 ↓
      Stream Router (in-memory)
                 ↓
      ┌──────────┼──────────┬──────────────┐
      ↓          ↓          ↓              ↓
  Mobile     Web App    ML Service    ML Service
  (alerts)   (video/    (WE push      (pushes alerts
             alerts)    frames TO it)  back TO us)
```

---

## Authentication

All WebSocket connections require a valid Better Auth session token:

**Methods:**

1. Query parameter: `?token=xxx`
2. Authorization header: `Authorization: Bearer xxx`
3. Cookie: `better-auth.session_token=xxx`

The server verifies the token against the shared database (same DB as web app).

---

## WebSocket Endpoints

### 1. `/streams/register` - Mobile Client Endpoint

Mobile clients connect here to start streaming video.

**Connection:**

```javascript
const token = "your-better-auth-session-token";
const ws = new WebSocket(`ws://localhost:3000/streams/register?token=${token}`);
```

**After Connection - Send Registration Message:**

```json
{
  "type": "register",
  "clientType": "mobile",
  "streamId": "optional-custom-id",
  "produces": ["video-frame"],
  "consumes": ["alert"]
}
```

**Response:**

```json
{
  "type": "success",
  "message": "Registration successful. Stream ID: stream_1234567890_abc",
  "timestamp": 1729943200000
}
```

**Then Start Streaming:**

```json
{
  "type": "video-frame",
  "streamId": "stream_1234567890_abc",
  "data": "base64_encoded_frame",
  "timestamp": 1729943200000
}
```

---

### 2. `/streams/subscribe` - Web App Endpoint

Web app connects here to view video streams and receive alerts.

**Note:** Only mobile and web app clients connect to us. ML service does NOT connect - we push data TO the ML service.

**Connection:**

```javascript
const token = "your-better-auth-session-token";
const ws = new WebSocket(
  `ws://localhost:3000/streams/subscribe?token=${token}`,
);
```

**After Connection - Send Subscription Message:**

```json
{
  "type": "subscribe",
  "clientType": "dashboard",
  "streamId": "stream_1234567890_abc",
  "consumes": ["video-frame", "alert"]
}
```

**Response:**

```json
{
  "type": "success",
  "message": "Subscription successful",
  "timestamp": 1729943200000
}
```

**Then Receive Video Frames:**

```json
{
  "type": "video-frame",
  "streamId": "stream_1234567890_abc",
  "data": "base64_encoded_frame",
  "timestamp": 1729943200000
}
```

**And Receive Alerts:**

```json
{
  "type": "alert",
  "streamId": "stream_1234567890_abc",
  "severity": "high",
  "message": "Suspicious activity detected",
  "metadata": {
    "confidence": 0.95,
    "location": { "x": 120, "y": 350 }
  },
  "timestamp": 1729943200000
}
```

---

## Message Types

### Client → Server

#### 1. Register (Mobile Only)

```typescript
{
  type: "register";
  clientType: "mobile";
  streamId?: string; // Optional - server generates if not provided
  produces: ("video-frame" | "alert")[];
  consumes: ("video-frame" | "alert")[];
}
```

#### 2. Subscribe (Web App Only)

```typescript
{
  type: "subscribe";
  clientType: "dashboard";
  streamId: string; // Required - must match mobile stream ID
  consumes: ("video-frame" | "alert")[];
}
```

**Note:** ML service does NOT subscribe. We push frames TO the ML service.

#### 3. Video Frame (Mobile Only)

```typescript
{
  type: "video-frame";
  streamId: string;
  data: string; // base64 encoded frame
  timestamp: number;
}
```

#### 4. Alert (From ML Service - future)

```typescript
{
  type: "alert";
  streamId: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  metadata?: {
    confidence?: number;
    location?: { x: number; y: number };
    objectType?: string;
    [key: string]: any;
  };
  timestamp: number;
}
```

**Note:** ML service sends alerts back TO us (via HTTP POST or WebSocket we initiated). We then broadcast to mobile + web app.

### Server → Client

#### 1. Success

```typescript
{
  type: "success";
  message: string;
  timestamp: number;
}
```

#### 2. Error

```typescript
{
  type: "error";
  code: string;
  message: string;
  timestamp: number;
}
```

**Error Codes:**

- `AUTH_REQUIRED` - Connection not authenticated
- `UNAUTHORIZED` - User doesn't have permission
- `INVALID_MESSAGE` - Message format is incorrect
- `ROUTING_ERROR` - Failed to route message
- `UNKNOWN_MESSAGE_TYPE` - Unsupported message type

#### 3. Status Update

```typescript
{
  type: "status";
  streamId: string;
  status: "online" | "offline" | "streaming";
  timestamp: number;
}
```

---

## Message Flow

### Video Streaming Flow

```
1. Mobile connects to /streams/register
2. Mobile sends "register" message
3. Server responds with success + streamId
4. Mobile starts sending "video-frame" messages
5. Server broadcasts frames to:
   - All WebSocket subscribers (web app at /streams/subscribe)
   - TODO: ML service (WE push TO ML service via HTTP/WebSocket/Queue)
6. Web app receives frames in real-time
```

### Alert Flow (Future)

```
1. WE push video frames TO ML service (initiated by us)
2. ML service analyzes and detects anomaly
3. ML service sends alert back TO US (via HTTP POST or WebSocket we initiated)
4. Server broadcasts alert to:
   - Mobile client (via /streams/register connection)
   - Web app (via /streams/subscribe connection)
5. Alert persistence handled by separate service
```

**Key Point:** ML service does NOT connect to us. WE initiate the connection and push data TO it.

---

## HTTP Endpoints

### GET `/health`

Health check endpoint (no authentication required).

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-10-26T12:34:56.000Z",
  "stats": {
    "totalProducers": 5,
    "totalVideoConsumers": 12,
    "totalAlertConsumers": 15,
    "totalConnections": 20,
    "activeStreams": ["stream_1", "stream_2"]
  }
}
```

### GET `/stats`

Connection statistics (no authentication required).

**Response:**

```json
{
  "totalProducers": 5,
  "totalVideoConsumers": 12,
  "totalAlertConsumers": 15,
  "totalConnections": 20,
  "activeStreams": ["stream_1", "stream_2"]
}
```

---

## Complete Examples

### Mobile Client (React Native / Swift)

```javascript
// 1. Get session token from your auth flow
const token = await getAuthToken();

// 2. Connect to registration endpoint
const ws = new WebSocket(`ws://localhost:3000/streams/register?token=${token}`);

ws.onopen = () => {
  console.log("Connected to stream router");

  // 3. Register as mobile producer
  ws.send(
    JSON.stringify({
      type: "register",
      clientType: "mobile",
      produces: ["video-frame"],
      consumes: ["alert"],
      // streamId is optional - server will generate if not provided
    }),
  );
};

let streamId = null;

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "success") {
    // Extract streamId from success message
    const match = message.message.match(/Stream ID: (stream_\w+)/);
    if (match) {
      streamId = match[1];
      console.log("Registered with stream ID:", streamId);
      // Start streaming video
      startVideoCapture();
    }
  } else if (message.type === "alert") {
    // Display alert to user
    showAlert(message.severity, message.message);
  } else if (message.type === "error") {
    console.error("Error:", message.code, message.message);
  }
};

// 4. Send video frames
function sendVideoFrame(frameData) {
  if (!streamId) {
    console.error("Not registered yet");
    return;
  }

  ws.send(
    JSON.stringify({
      type: "video-frame",
      streamId: streamId,
      data: frameData, // base64 encoded
      timestamp: Date.now(),
    }),
  );
}

// Start capturing and sending frames
function startVideoCapture() {
  // Capture frame from camera every 100ms (10 fps)
  setInterval(() => {
    const frame = captureFrameFromCamera(); // Your camera logic
    const base64Frame = encodeFrameToBase64(frame);
    sendVideoFrame(base64Frame);
  }, 100);
}
```

---

### Web App Subscriber (React)

```javascript
// 1. Get session token (already authenticated)
const token = getSessionToken();

// 2. Get stream ID (from user selection or props)
const streamId = "stream_1234567890_abc";

// 3. Connect to subscription endpoint
const ws = new WebSocket(
  `ws://localhost:3000/streams/subscribe?token=${token}`,
);

ws.onopen = () => {
  console.log("Connected to stream router");

  // 4. Subscribe to stream
  ws.send(
    JSON.stringify({
      type: "subscribe",
      clientType: "dashboard",
      streamId: streamId,
      consumes: ["video-frame", "alert"],
    }),
  );
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "video-frame") {
    // Display video frame
    const imgElement = document.getElementById("video-feed");
    imgElement.src = `data:image/jpeg;base64,${message.data}`;
  } else if (message.type === "alert") {
    // Show alert notification
    toast.error(`${message.severity.toUpperCase()}: ${message.message}`);
  } else if (message.type === "status") {
    // Update stream status indicator
    updateStreamStatus(message.status);
  } else if (message.type === "success") {
    console.log("Subscribed successfully");
  } else if (message.type === "error") {
    console.error("Error:", message.code, message.message);
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("Disconnected from stream");
  // Implement reconnection logic here
};
```

---

### React Hook Example

```typescript
import { useEffect, useState, useRef } from 'react';

function useVideoStream(streamId: string, token: string) {
  const [frameData, setFrameData] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3000/streams/subscribe?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({
        type: 'subscribe',
        clientType: 'dashboard',
        streamId: streamId,
        consumes: ['video-frame', 'alert']
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'video-frame') {
        setFrameData(message.data);
      }
    };

    ws.onerror = () => {
      setStatus('error');
    };

    return () => {
      ws.close();
    };
  }, [streamId, token]);

  return { frameData, status };
}

// Usage in component
function VideoPlayer({ streamId }: { streamId: string }) {
  const token = getSessionToken();
  const { frameData, status } = useVideoStream(streamId, token);

  if (status === 'connecting') {
    return <div>Connecting...</div>;
  }

  if (status === 'error') {
    return <div>Connection error</div>;
  }

  return (
    <div>
      {frameData ? (
        <img
          src={`data:image/jpeg;base64,${frameData}`}
          alt="Video stream"
          className="w-full h-auto"
        />
      ) : (
        <div>Waiting for video...</div>
      )}
    </div>
  );
}
```

---

## ML Service Integration (TODO)

**Important:** The ML service does NOT connect to us as a WebSocket client. WE initiate the connection and push frames TO it.

The server currently has TODO comments for ML service forwarding. When implementing:

### Option 1: HTTP POST (Server Pushes to ML Service)

We POST each video frame to ML service endpoint:

```typescript
// In message-router.ts handleVideoFrame method:
const mlServiceUrl = process.env.ML_SERVICE_URL;
if (mlServiceUrl) {
  try {
    const response = await fetch(`${mlServiceUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streamId: message.streamId,
        frame: message.data,
        timestamp: message.timestamp,
      }),
    });

    // Optional: ML service can return alerts in HTTP response
    if (response.ok) {
      const result = await response.json();
      if (result.alert) {
        // Broadcast alert to clients
        this.handleAlert(ws, result.alert);
      }
    }
  } catch (error) {
    console.error("[MessageRouter] Failed to forward to ML service:", error);
  }
}
```

**ML Service receives:**

```python
# ML Service Flask/FastAPI endpoint
@app.post("/analyze")
async def analyze_frame(request: FrameRequest):
    frame = decode_base64(request.frame)
    result = analyze_frame(frame)

    if result["is_suspicious"]:
        return {
            "alert": {
                "type": "alert",
                "streamId": request.streamId,
                "severity": "high",
                "message": "Suspicious activity detected",
                "metadata": result["details"],
                "timestamp": int(time.time() * 1000)
            }
        }

    return {"status": "ok"}
```

### Option 2: WebSocket Client (We Connect TO ML Service)

We maintain a persistent WebSocket connection TO ML service:

```typescript
// At server startup, connect to ML service
const mlWs = new WebSocket(process.env.ML_SERVICE_WS_URL);

mlWs.onmessage = (event) => {
  const alert = JSON.parse(event.data);
  // Broadcast alert to mobile + web app
  this.handleAlert(null, alert);
};

// In handleVideoFrame, forward to ML service
mlWs.send(
  JSON.stringify({
    streamId: message.streamId,
    frame: message.data,
    timestamp: message.timestamp,
  }),
);
```

**ML Service:**

```python
# ML Service WebSocket server
import asyncio
import websockets

async def analyze_stream(websocket):
    async for message in websocket:
        data = json.loads(message)
        frame = decode_base64(data["frame"])
        result = analyze_frame(frame)

        if result["is_suspicious"]:
            # Send alert back through same connection
            await websocket.send(json.dumps({
                "type": "alert",
                "streamId": data["streamId"],
                "severity": "high",
                "message": "Suspicious activity detected",
                "metadata": result["details"],
                "timestamp": int(time.time() * 1000)
            }))

# ML service listens, we connect TO it
start_server = websockets.serve(analyze_stream, "0.0.0.0", 8765)
```

### Option 3: Message Queue (Decoupled)

Use Redis/RabbitMQ for decoupling:

```typescript
// Publish frames to queue
await redis.publish(
  "video-frames",
  JSON.stringify({
    streamId: message.streamId,
    frame: message.data,
    timestamp: message.timestamp,
  }),
);

// Subscribe to alerts queue
redis.subscribe("ml-alerts", (alert) => {
  this.handleAlert(null, JSON.parse(alert));
});
```

---

## Environment Variables

```env
# Database connection (for auth verification only)
DATABASE_URL=postgresql://user:password@host:5432/watchout

# Server port
PORT=3000

# ML Service URL (optional - for future use)
ML_SERVICE_URL=http://ml-service:8000
```

**Important:** `DATABASE_URL` must be the same database as your web app for Better Auth session verification.

---

## Key Differences from Original Design

1. **No REST API** - Mobile registration happens via WebSocket, not REST
2. **No Database Writes** - All stream state is in-memory only
3. **No Alert Persistence** - Alerts are routed in real-time, not stored
4. **Separate WebSocket Endpoints** - `/streams/register` for mobile, `/streams/subscribe` for web app
5. **ML Service TODO** - Forwarding logic exists as TODO comments in code

---

## Production Considerations

1. **State Loss on Restart** - All active streams are lost if server restarts (in-memory only)
2. **Horizontal Scaling** - Can't scale horizontally without shared state (Redis, etc.)
3. **Reconnection Logic** - Clients should implement auto-reconnect
4. **Stream ID Management** - Mobile clients should track their stream IDs
5. **SSL/TLS** - Use `wss://` for production WebSocket connections
6. **Rate Limiting** - Consider limiting video frame rate per stream
7. **Payload Size** - 16MB max per message (sufficient for most video frames)

---

## Testing

Run the server:

```bash
bun dev
```

Test with the included test client:

```bash
bun run test:client
```

Health check:

```bash
curl http://localhost:3000/health
```

---

## Questions & Answers

**Q: Why no database for streams?**
A: This is a pure router. Stream metadata and history are managed by the web app codebase. This server only routes real-time data.

**Q: What happens to streams when server restarts?**
A: All connections are dropped. Clients must reconnect and re-register.

**Q: How do I list available streams?**
A: That's handled by your web app codebase, not this router.

**Q: Where are alerts stored?**
A: Alert persistence is handled by a separate service/codebase.

**Q: How does ML service connect?**
A: Currently TODO - will either connect as WebSocket client or receive HTTP POSTs.
