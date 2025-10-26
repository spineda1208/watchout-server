# WebSocket Implementation Todos

## Architecture Overview

We're building a **bidirectional pub-sub relay system** where:
- **Mobile clients** stream video and receive alerts
- **Dashboard (web app)** views video and receives alerts
- **ML service** analyzes video and sends alerts back to mobile + dashboard
- **Next.js server** acts as the relay/router between all clients

### Message Flow
```
Mobile → Server → Dashboard (video)
                → ML Service (video)

ML Service → Server → Mobile (alerts)
                    → Dashboard (alerts)
```

## Database Schema (Already Completed ✅)

Located in: `src/db/schema/`

### `video_stream` table
- Stores registered mobile devices
- Fields: id, userId, deviceName, deviceType, status, lastSeen, metadata, createdAt, updatedAt

### `alert` table
- Stores alert history
- Fields: id, streamId, severity, message, metadata, createdAt

## Implementation Todos

### 1. WebSocket Server Infrastructure ⚠️ PRIORITY

**Goal**: Set up persistent WebSocket server that can handle multiple client types

**Context**: 
- Next.js on Vercel doesn't support WebSocket
- Need custom server (for Railway/Render deployment) OR separate WebSocket service
- Server needs to maintain persistent connections in memory
- Must handle upgrade requests from HTTP to WebSocket

**Files to Create**:
- `server.ts` - Custom Next.js server with WebSocket support
- OR separate `ws-server/` directory for standalone WebSocket server

**Requirements**:
- Accept WebSocket connections on `/api/streams/ws` endpoint
- Keep connections alive with heartbeat/ping-pong
- Handle connection cleanup on disconnect
- Support concurrent connections (many clients at once)

**Implementation Notes**:
- Use `ws` library: `npm install ws @types/ws`
- If custom Next.js server: modify `package.json` scripts to use custom server
- Server must handle both HTTP (Next.js) and WebSocket upgrade requests

---

### 2. Connection Manager 🎯 CRITICAL

**Goal**: Track all active WebSocket connections and route messages appropriately

**Context**:
- Server needs to know "who's connected" and "what do they want"
- Mobile produces video, consumes alerts
- Dashboard consumes video and alerts
- ML service consumes video, produces alerts
- All communication happens through the server (relay pattern)

**Data Structures Needed**:
```typescript
// Example structure
class ConnectionManager {
  // Map streamId → WebSocket connection from mobile
  private videoProducers: Map<string, WebSocket>;
  
  // Map streamId → array of WebSocket connections (dashboard, ML)
  private videoConsumers: Map<string, WebSocket[]>;
  
  // Map streamId → array of WebSocket connections (mobile, dashboard)
  private alertConsumers: Map<string, WebSocket[]>;
  
  // Map WebSocket → client metadata (userId, streamId, clientType)
  private connectionMetadata: Map<WebSocket, ClientMetadata>;
}
```

**Files to Create**:
- `src/lib/ws/connection-manager.ts` - Main connection tracking logic

**Key Methods**:
```typescript
registerProducer(streamId: string, ws: WebSocket, type: "video" | "alert")
registerConsumer(streamId: string, ws: WebSocket, type: "video" | "alert")
removeConnection(ws: WebSocket)
getConsumers(streamId: string, type: "video" | "alert"): WebSocket[]
getProducer(streamId: string, type: "video" | "alert"): WebSocket | null
```

---

### 3. Message Routing Logic 🔀 CRITICAL

**Goal**: Route messages from producers to correct consumers based on message type

**Context**:
- Mobile sends: `{ type: "video-frame", streamId: "abc", data: <binary> }`
- ML sends: `{ type: "alert", streamId: "abc", severity: "high", message: "..." }`
- Server must forward to appropriate subscribers only

**Message Types**:
```typescript
// From Mobile
type VideoFrameMessage = {
  type: "video-frame";
  streamId: string;
  data: string | Buffer; // base64 or binary
  timestamp: number;
}

// From ML Service
type AlertMessage = {
  type: "alert";
  streamId: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  metadata?: {
    confidence: number;
    location?: { x: number; y: number };
    objectType?: string;
  };
  timestamp: number;
}

// Client Registration
type RegisterMessage = {
  type: "register" | "subscribe";
  clientType: "mobile" | "dashboard" | "ml-service";
  streamId: string;
  produces?: ("video-frame" | "alert")[];
  consumes?: ("video-frame" | "alert")[];
  userId?: string; // for auth
  token?: string; // for auth
}
```

**Files to Create**:
- `src/lib/ws/message-router.ts` - Message routing logic
- `src/lib/ws/types.ts` - TypeScript types for messages

**Routing Logic**:
```typescript
function routeMessage(ws: WebSocket, message: Message) {
  switch (message.type) {
    case "video-frame":
      // Get all consumers subscribed to this stream's video
      const videoConsumers = connectionManager.getConsumers(message.streamId, "video");
      broadcast(videoConsumers, message);
      break;
      
    case "alert":
      // Get all consumers subscribed to this stream's alerts
      const alertConsumers = connectionManager.getConsumers(message.streamId, "alert");
      broadcast(alertConsumers, message);
      break;
      
    case "register":
      // Add producer to connection manager
      connectionManager.registerProducer(message.streamId, ws, ...);
      break;
      
    case "subscribe":
      // Add consumer to connection manager
      connectionManager.registerConsumer(message.streamId, ws, ...);
      break;
  }
}
```

---

### 4. REST API - Register Stream 📱

**Goal**: Mobile client registers itself before streaming

**Endpoint**: `POST /api/streams/register`

**Request**:
```json
{
  "deviceName": "iPhone 14",
  "deviceType": "mobile",
  "metadata": {
    "resolution": "1920x1080",
    "fps": 30
  }
}
```

**Response**:
```json
{
  "streamId": "stream_abc123",
  "message": "Stream registered successfully"
}
```

**Files to Create**:
- `src/app/api/streams/register/route.ts`

**Logic**:
1. Verify user is authenticated (get userId from session)
2. Generate unique streamId
3. Insert into `video_stream` table
4. Return streamId to client

---

### 5. REST API - List Streams 📺

**Goal**: Dashboard queries which streams belong to current user

**Endpoint**: `GET /api/streams/list`

**Response**:
```json
{
  "streams": [
    {
      "id": "stream_abc123",
      "deviceName": "iPhone 14",
      "status": "online",
      "lastSeen": "2025-10-26T10:30:00Z",
      "metadata": {
        "resolution": "1920x1080",
        "fps": 30
      }
    }
  ]
}
```

**Files to Create**:
- `src/app/api/streams/list/route.ts`

**Logic**:
1. Verify user is authenticated
2. Query `video_stream` table WHERE userId = currentUser
3. Return list of streams

---

### 6. REST API - Alert History 🚨

**Goal**: Dashboard can view past alerts

**Endpoint**: `GET /api/alerts?streamId=abc&limit=50`

**Response**:
```json
{
  "alerts": [
    {
      "id": "alert_123",
      "streamId": "stream_abc",
      "severity": "high",
      "message": "Suspicious person detected",
      "metadata": {
        "confidence": 0.95
      },
      "createdAt": "2025-10-26T10:30:00Z"
    }
  ]
}
```

**Files to Create**:
- `src/app/api/alerts/route.ts`

**Logic**:
1. Verify user is authenticated
2. Verify user owns the streamId
3. Query `alert` table
4. Return paginated results

---

### 7. WebSocket Authentication 🔐

**Goal**: Verify clients are who they say they are

**Context**:
- Clients must send auth token on connection
- Server validates token before accepting messages
- Prevent unauthorized access to streams

**Implementation**:
```typescript
// Client sends on connection:
{
  type: "auth",
  token: "session_token_here"
}

// Server validates:
const session = await validateSessionToken(token);
if (!session) {
  ws.close(1008, "Unauthorized");
  return;
}

// Store userId with connection
connectionManager.setUserId(ws, session.userId);
```

**Files to Modify**:
- Connection manager - add userId tracking
- Message router - add auth validation

---

### 8. Permission Checks ✅

**Goal**: Ensure users can only access their own streams

**Context**:
- User A shouldn't be able to subscribe to User B's stream
- Check ownership before allowing subscription

**Logic**:
```typescript
async function canAccessStream(userId: string, streamId: string): Promise<boolean> {
  const stream = await db.query.videoStream.findFirst({
    where: eq(videoStream.id, streamId)
  });
  return stream?.userId === userId;
}
```

**Files to Modify**:
- Message router - add permission checks before subscribing

---

### 9. Dashboard - Fetch Real Streams 🖥️

**Goal**: Replace mock data with real API calls

**Files to Modify**:
- `src/app/dashboard/video-feeds/page.tsx`

**Changes**:
1. Remove `mockFeeds` array
2. Add `useEffect` to fetch from `/api/streams/list`
3. Display loading state
4. Handle errors

**Example**:
```typescript
const [streams, setStreams] = useState([]);

useEffect(() => {
  fetch('/api/streams/list')
    .then(res => res.json())
    .then(data => setStreams(data.streams));
}, []);
```

---

### 10. Dashboard - WebSocket Client 🔌

**Goal**: Connect dashboard to WebSocket and receive video frames

**Files to Create**:
- `src/lib/ws/client.ts` - WebSocket client wrapper
- `src/hooks/useVideoStream.ts` - React hook for video streaming

**Example Hook**:
```typescript
function useVideoStream(streamId: string) {
  const [frameData, setFrameData] = useState<string | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3000/api/streams/ws');
    
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "subscribe",
        clientType: "dashboard",
        streamId: streamId,
        consumes: ["video-frame", "alert"]
      }));
    };
    
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "video-frame") {
        setFrameData(message.data);
      }
    };
    
    setWs(socket);
    return () => socket.close();
  }, [streamId]);
  
  return { frameData };
}
```

---

### 11. Dashboard - Video Player Component 🎥

**Goal**: Display incoming video frames

**Files to Create**:
- `src/components/video-player.tsx`

**Implementation**:
```typescript
function VideoPlayer({ streamId }: { streamId: string }) {
  const { frameData } = useVideoStream(streamId);
  
  return (
    <div className="aspect-video bg-black">
      {frameData ? (
        <img src={`data:image/jpeg;base64,${frameData}`} alt="Video frame" />
      ) : (
        <div>Connecting...</div>
      )}
    </div>
  );
}
```

---

### 12. Dashboard - Alert Notifications 🔔

**Goal**: Show real-time alerts as they come in

**Files to Create**:
- `src/hooks/useAlerts.ts` - React hook for alerts
- `src/components/alert-toast.tsx` - Toast notification component

**Libraries to Use**:
- Consider using `sonner` or `react-hot-toast` for toast notifications

**Example**:
```typescript
function useAlerts(streamId: string) {
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3000/api/streams/ws');
    
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "alert") {
        toast.error(message.message, {
          description: `Severity: ${message.severity}`,
        });
      }
    };
    
    return () => socket.close();
  }, [streamId]);
}
```

---

### 13. Dashboard - Alert History Page 📜

**Goal**: View past alerts

**Files to Create**:
- `src/app/dashboard/alerts/page.tsx`

**Features**:
- List all alerts for user's streams
- Filter by severity, stream, date
- Pagination
- Click to see details (metadata)

---

### 14. Mobile Client Example 📱

**Goal**: Documentation for mobile developers

**Files to Create**:
- `docs/MOBILE_CLIENT.md`

**Contents**:
1. How to register a stream
2. How to connect to WebSocket
3. How to send video frames
4. How to receive alerts
5. Example code (React Native or Swift)

**Example Flow**:
```
1. Login to get auth token
2. POST /api/streams/register → get streamId
3. Connect to ws://server/api/streams/ws
4. Send: { type: "register", streamId, clientType: "mobile", ... }
5. Start sending video frames
6. Listen for alert messages
```

---

### 15. Python ML Service Example 🤖

**Goal**: Example client for ML service

**Files to Create**:
- `examples/ml-service/client.py`

**Example**:
```python
import websocket
import json
import cv2

ws = websocket.WebSocket()
ws.connect("ws://localhost:3000/api/streams/ws")

# Subscribe to stream
ws.send(json.dumps({
    "type": "subscribe",
    "clientType": "ml-service",
    "streamId": "stream_abc",
    "consumes": ["video-frame"],
    "produces": ["alert"]
}))

# Receive frames and analyze
while True:
    data = ws.recv()
    message = json.loads(data)
    
    if message["type"] == "video-frame":
        # Decode frame
        frame = decode_base64_image(message["data"])
        
        # Run ML model
        results = detect_suspicious_activity(frame)
        
        if results["is_suspicious"]:
            # Send alert
            ws.send(json.dumps({
                "type": "alert",
                "streamId": message["streamId"],
                "severity": "high",
                "message": "Suspicious activity detected",
                "metadata": {
                    "confidence": results["confidence"],
                    "objectType": results["object"]
                }
            }))
```

---

### 16. Error Handling & Reconnection 🔄

**Goal**: Graceful handling of disconnections

**Requirements**:
- Auto-reconnect on disconnect
- Exponential backoff
- Queue messages while disconnected
- Update stream status in DB

**Implementation Areas**:
- Server: Clean up on disconnect, update `lastSeen` in DB
- Client: Implement reconnection logic

---

### 17. Heartbeat Mechanism 💓

**Goal**: Detect dead connections

**Implementation**:
```typescript
// Server sends ping every 30 seconds
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Client responds to ping with pong
ws.on('pong', () => {
  ws.isAlive = true;
});
```

---

### 18. Cleanup on Disconnect 🧹

**Goal**: Update database and remove from memory when client disconnects

**Logic**:
```typescript
ws.on('close', async () => {
  const metadata = connectionManager.getMetadata(ws);
  
  // Remove from connection manager
  connectionManager.removeConnection(ws);
  
  // Update database
  if (metadata.clientType === 'mobile') {
    await db.update(videoStream)
      .set({ 
        status: 'offline',
        lastSeen: new Date()
      })
      .where(eq(videoStream.id, metadata.streamId));
  }
});
```

---

### 19. Stream Status Tracking 📊

**Goal**: Real-time status updates (online/offline/streaming)

**Implementation**:
- Update status to "online" when mobile connects
- Update status to "streaming" when mobile sends first frame
- Update status to "offline" on disconnect
- Broadcast status changes to dashboard subscribers

---

### 20. Testing Infrastructure 🧪

**Goal**: Automated tests for WebSocket

**Files to Create**:
- `tests/ws-server.test.ts`

**Test Cases**:
- Connection establishment
- Message routing
- Authentication
- Permissions
- Cleanup on disconnect

---

### 21. API Documentation 📚

**Goal**: Complete API reference

**Files to Create**:
- `docs/API.md`

**Sections**:
1. REST API endpoints
2. WebSocket message protocol
3. Authentication flow
4. Error codes
5. Rate limits (if any)

---

## Deployment Notes

### For Railway/Render/Fly.io:
- Use custom server approach
- Set environment variables
- Configure database connection
- Enable WebSocket support

### Architecture Diagram:
```
┌─────────────────────────────────────────┐
│         Next.js + WebSocket Server      │
│                                         │
│  ┌──────────────┐  ┌─────────────────┐│
│  │ Next.js App  │  │ WebSocket Server││
│  │ (HTTP/React) │  │ (Persistent WS) ││
│  └──────────────┘  └─────────────────┘│
└─────────────────────────────────────────┘
          ▲                  ▲
          │                  │
    ┌─────┴─────┬───────────┴──────┬──────────┐
    │           │                  │          │
┌───▼───┐  ┌───▼────┐      ┌──────▼─────┐  ┌─▼────┐
│Mobile │  │Dashboard│      │ ML Service │  │  DB  │
└───────┘  └─────────┘      └────────────┘  └──────┘
```

## Priority Order for Implementation:
1. ✅ Database Schema (DONE)
2. WebSocket Server Infrastructure
3. Connection Manager
4. Message Routing Logic
5. REST API endpoints (register, list, alerts)
6. WebSocket Authentication
7. Dashboard WebSocket client
8. Dashboard video player
9. Alert notifications
10. Everything else (examples, docs, etc.)
