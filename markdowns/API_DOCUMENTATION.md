# Watchout Server API Documentation

## Overview

The Watchout server provides both REST API endpoints and WebSocket connections for video streaming and alert management. All endpoints require authentication via Better Auth.

## Authentication

All requests must include an authentication token in one of the following ways:

1. **Query Parameter**: `?token=xxx`
2. **Authorization Header**: `Authorization: Bearer xxx`
3. **Cookie**: `better-auth.session_token=xxx`

The token must be a valid Better Auth session token from your web app.

---

## REST API Endpoints

### 1. POST /streams/register

Register a new video stream from a mobile device.

**Authentication**: Required

**Request Body**:
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

**Response** (200 OK):
```json
{
  "streamId": "stream_1729943200000_abc123",
  "message": "Stream registered successfully"
}
```

**Error Responses**:
- `401 Unauthorized`: Missing or invalid authentication token
- `400 Bad Request`: Missing required fields (deviceName, deviceType)
- `500 Internal Server Error`: Database error

**Usage Flow**:
1. Mobile client authenticates with web app to get session token
2. Mobile client calls this endpoint to register their stream
3. Server returns a `streamId` that must be used for WebSocket registration
4. Mobile client can now connect to WebSocket and stream video

---

### 2. GET /streams

List all video streams for the authenticated user.

**Authentication**: Required

**Response** (200 OK):
```json
{
  "streams": [
    {
      "id": "stream_1729943200000_abc123",
      "userId": "user_xyz",
      "deviceName": "iPhone 14",
      "deviceType": "mobile",
      "status": "streaming",
      "lastSeen": "2025-10-26T12:34:56.000Z",
      "metadata": {
        "resolution": "1920x1080",
        "fps": 30
      },
      "createdAt": "2025-10-26T10:00:00.000Z",
      "updatedAt": "2025-10-26T12:34:56.000Z"
    }
  ]
}
```

**Stream Status Values**:
- `offline`: Stream is registered but not currently streaming
- `online`: Mobile client is connected but not streaming yet
- `streaming`: Mobile client is actively streaming video

**Error Responses**:
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Database error

---

### 3. GET /alerts

Retrieve alert history for a specific stream.

**Authentication**: Required

**Query Parameters**:
- `streamId` (required): The stream ID to get alerts for
- `limit` (optional): Number of alerts to return (default: 50)

**Example**: `/alerts?streamId=stream_1729943200000_abc123&limit=100`

**Response** (200 OK):
```json
{
  "alerts": [
    {
      "id": "alert_1729943300000_def456",
      "streamId": "stream_1729943200000_abc123",
      "severity": "high",
      "message": "Suspicious person detected",
      "metadata": {
        "confidence": 0.95,
        "location": { "x": 120, "y": 350 },
        "objectType": "person"
      },
      "createdAt": "2025-10-26T12:35:00.000Z"
    }
  ]
}
```

**Severity Levels**:
- `low`: Minor event
- `medium`: Notable event
- `high`: Important event requiring attention
- `critical`: Urgent event requiring immediate action

**Error Responses**:
- `401 Unauthorized`: Missing or invalid authentication token
- `400 Bad Request`: Missing streamId parameter
- `404 Not Found`: Stream not found or user doesn't own the stream
- `500 Internal Server Error`: Database error

---

### 4. GET /health

Health check endpoint (no authentication required).

**Response** (200 OK):
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

---

### 5. GET /stats

Connection statistics (no authentication required).

**Response** (200 OK):
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

## WebSocket API

### Connection

**Endpoint**: `ws://localhost:3000/ws` (or `wss://` for production)

**Authentication**: Required (token must be provided as query parameter, header, or cookie)

**Example**:
```javascript
const token = "your-better-auth-session-token";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
```

### Message Types

All messages are JSON-formatted strings.

#### 1. Register (Mobile Client)

Mobile clients must register after connecting to start streaming.

**Send**:
```json
{
  "type": "register",
  "clientType": "mobile",
  "streamId": "stream_1729943200000_abc123",
  "produces": ["video-frame"],
  "consumes": ["alert"]
}
```

**Response**:
```json
{
  "type": "success",
  "message": "Registration successful",
  "timestamp": 1729943200000
}
```

**Notes**:
- `streamId` must be obtained from POST /streams/register first
- Mobile clients typically produce video-frame and consume alert
- Server verifies that the authenticated user owns the stream

---

#### 2. Subscribe (Dashboard/ML Service)

Dashboard and ML services subscribe to receive video and/or alerts.

**Send**:
```json
{
  "type": "subscribe",
  "clientType": "dashboard",
  "streamId": "stream_1729943200000_abc123",
  "consumes": ["video-frame", "alert"]
}
```

**For ML Service**:
```json
{
  "type": "subscribe",
  "clientType": "ml-service",
  "streamId": "stream_1729943200000_abc123",
  "consumes": ["video-frame"],
  "produces": ["alert"]
}
```

**Response**:
```json
{
  "type": "success",
  "message": "Subscription successful",
  "timestamp": 1729943200000
}
```

**Notes**:
- Dashboard clients verify they own the stream
- ML service can subscribe to any stream (for analysis purposes)
- ML service can both consume video-frame and produce alert

---

#### 3. Video Frame (Mobile → Dashboard/ML)

Mobile clients send video frames that are broadcast to all subscribers.

**Send**:
```json
{
  "type": "video-frame",
  "streamId": "stream_1729943200000_abc123",
  "data": "base64_encoded_frame_data",
  "timestamp": 1729943200000
}
```

**Received by Subscribers**:
Same format as sent - all subscribers receive the video frame.

**Notes**:
- Data can be base64-encoded JPEG/PNG
- Timestamp should be in milliseconds
- Server broadcasts to ALL subscribers (dashboard, ML service)
- Server logs warning if no ML service is connected

---

#### 4. Alert (ML Service → Mobile/Dashboard)

ML service sends alerts that are broadcast to mobile and dashboard clients.

**Send**:
```json
{
  "type": "alert",
  "streamId": "stream_1729943200000_abc123",
  "severity": "high",
  "message": "Suspicious person detected",
  "metadata": {
    "confidence": 0.95,
    "location": { "x": 120, "y": 350 },
    "objectType": "person"
  },
  "timestamp": 1729943200000
}
```

**Received by Subscribers**:
Same format as sent - all alert consumers receive the alert.

**Notes**:
- Alert is automatically stored in database
- Broadcast to mobile client and dashboard
- Severity must be one of: low, medium, high, critical
- Metadata is optional but recommended

---

#### 5. Status Update (Server → Clients)

Server automatically sends status updates to subscribers.

**Receive**:
```json
{
  "type": "status",
  "streamId": "stream_1729943200000_abc123",
  "status": "streaming",
  "timestamp": 1729943200000
}
```

**Status Values**:
- `online`: Mobile client connected
- `streaming`: Mobile client actively streaming
- `offline`: Mobile client disconnected

---

#### 6. Error (Server → Client)

Server sends error messages when something goes wrong.

**Receive**:
```json
{
  "type": "error",
  "code": "UNAUTHORIZED",
  "message": "Stream not found or you don't own this stream",
  "timestamp": 1729943200000
}
```

**Error Codes**:
- `AUTH_REQUIRED`: Connection not authenticated
- `UNAUTHORIZED`: User doesn't have permission for this stream
- `SERVER_ERROR`: Internal server error
- `INVALID_MESSAGE`: Message format is invalid
- `ROUTING_ERROR`: Failed to route message
- `UNKNOWN_MESSAGE_TYPE`: Unsupported message type

---

## Complete Usage Examples

### Mobile Client Flow

```javascript
// 1. Get session token from your web app authentication
const token = await getAuthToken();

// 2. Register stream via REST API
const response = await fetch('http://localhost:3000/streams/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    deviceName: 'iPhone 14',
    deviceType: 'mobile',
    metadata: { resolution: '1920x1080', fps: 30 }
  })
});

const { streamId } = await response.json();

// 3. Connect to WebSocket
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  // 4. Register with WebSocket
  ws.send(JSON.stringify({
    type: 'register',
    clientType: 'mobile',
    streamId: streamId,
    produces: ['video-frame'],
    consumes: ['alert']
  }));
};

// 5. Start streaming video
function streamVideoFrame(frameData) {
  ws.send(JSON.stringify({
    type: 'video-frame',
    streamId: streamId,
    data: frameData, // base64 encoded
    timestamp: Date.now()
  }));
}

// 6. Listen for alerts
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'alert') {
    console.log(`Alert: ${message.message} (${message.severity})`);
    showNotification(message);
  }
};
```

---

### Dashboard/Web App Flow

```javascript
// 1. Get session token (already authenticated)
const token = getSessionToken();

// 2. Fetch available streams
const response = await fetch('http://localhost:3000/streams', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const { streams } = await response.json();

// 3. Subscribe to a specific stream
const streamId = streams[0].id;
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    clientType: 'dashboard',
    streamId: streamId,
    consumes: ['video-frame', 'alert']
  }));
};

// 4. Display video and alerts
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'video-frame') {
    // Display video frame
    const img = document.getElementById('video-feed');
    img.src = `data:image/jpeg;base64,${message.data}`;
  } else if (message.type === 'alert') {
    // Show alert notification
    showAlert(message.severity, message.message);
  } else if (message.type === 'status') {
    // Update stream status indicator
    updateStatus(message.status);
  }
};

// 5. Fetch alert history
const alertsResponse = await fetch(
  `http://localhost:3000/alerts?streamId=${streamId}&limit=50`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const { alerts } = await alertsResponse.json();
displayAlertHistory(alerts);
```

---

### ML Service Flow

```javascript
// 1. Get service authentication token
const token = getServiceAuthToken();

// 2. Connect and subscribe to stream
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    clientType: 'ml-service',
    streamId: 'stream_1729943200000_abc123',
    consumes: ['video-frame'],
    produces: ['alert']
  }));
};

// 3. Process video frames and send alerts
ws.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'video-frame') {
    // Decode and analyze frame
    const frame = decodeBase64(message.data);
    const analysis = await analyzeFrame(frame);
    
    // Send alert if suspicious activity detected
    if (analysis.isSuspicious) {
      ws.send(JSON.stringify({
        type: 'alert',
        streamId: message.streamId,
        severity: analysis.severity,
        message: analysis.description,
        metadata: {
          confidence: analysis.confidence,
          location: analysis.location,
          objectType: analysis.objectType
        },
        timestamp: Date.now()
      }));
    }
  }
};
```

---

## Architecture Notes

### Video Frame Flow
```
Mobile Client (Producer)
    ↓ video-frame
WebSocket Server (Router)
    ↓ broadcast to all subscribers
    ├→ Dashboard (Consumer)
    ├→ ML Service (Consumer)
    └→ Other Subscribers (Consumer)
```

### Alert Flow
```
ML Service (Producer)
    ↓ alert
WebSocket Server (Router)
    ├→ Database (Store)
    └→ broadcast to all subscribers
        ├→ Mobile Client (Consumer)
        └→ Dashboard (Consumer)
```

### Key Points

1. **Authentication**: All connections require valid Better Auth session tokens
2. **Authorization**: Users can only access streams they own (ML service is exception)
3. **Stream Ownership**: Mobile clients must register streams via REST API first
4. **ML Service**: Should maintain persistent connection to ensure all footage is analyzed
5. **Alerts**: Automatically stored in database and broadcast to relevant clients
6. **Status Updates**: Server automatically tracks and broadcasts stream status changes
7. **Database Updates**: Stream status and lastSeen are updated automatically

---

## Error Handling

### Connection Errors

- **401 Unauthorized**: Token is missing or invalid
  - Solution: Ensure you're providing a valid Better Auth session token
  
- **400 WebSocket Upgrade Failed**: Connection couldn't be upgraded to WebSocket
  - Solution: Check network configuration and WebSocket support

### Message Errors

- **UNAUTHORIZED**: User doesn't have permission
  - Solution: Verify stream ownership and authentication
  
- **INVALID_MESSAGE**: Message format is incorrect
  - Solution: Ensure JSON is properly formatted and includes required fields

### Production Considerations

1. **SSL/TLS**: Use `wss://` for WebSocket in production
2. **Rate Limiting**: Consider implementing rate limits for video frames
3. **Compression**: Server has per-message compression enabled
4. **Payload Size**: Max 16MB per message (suitable for video frames)
5. **Idle Timeout**: 120 seconds - ensure clients send heartbeats
6. **Database**: Ensure database can handle alert storage volume
7. **ML Service**: Should auto-reconnect if connection drops

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@host:5432/watchout
PORT=3000
NEXTJS_URL=http://localhost:3001
```

**Important**: The `DATABASE_URL` must be the same database as your Next.js web app since Better Auth sessions are stored there.
