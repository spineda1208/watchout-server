# Watchout WebSocket Server 🚀

High-performance WebSocket server for real-time video streaming and alert broadcasting, built with [Bun](https://bun.sh)'s native APIs.

## 🎯 What is This?

This is a **bidirectional pub-sub relay system** that connects:
- 📱 **Mobile clients** - Stream video and receive alerts
- 🖥️ **Dashboard** - View video streams and receive alerts
- 🤖 **ML services** - Analyze video and send alerts

## ✨ Features

✅ Real-time video streaming (mobile → dashboard/ML)  
✅ Alert broadcasting (ML → mobile/dashboard)  
✅ Connection management and tracking  
✅ Status updates (online, offline, streaming)  
✅ Health check and statistics endpoints  
✅ Type-safe with TypeScript  
✅ Zero external dependencies (uses Bun's native WebSocket)  
✅ Built-in message compression  
✅ Supports up to 16MB payloads  

## 🚀 Quick Start

### Install Dependencies

```bash
bun install
```

### Run the Server

```bash
# Production
bun start

# Development (with hot reload)
bun dev
```

The server will start on `http://localhost:3000`:
- WebSocket: `ws://localhost:3000/ws`
- Health: `http://localhost:3000/health`
- Stats: `http://localhost:3000/stats`

### Test the Server

```bash
# Run the WebSocket test client
bun run test:client

# Run unit tests (when available)
bun test
```

The test client simulates mobile, dashboard, and ML service connections.

## 📁 Project Structure

```
.
├── src/
│   ├── index.ts              # Main WebSocket server
│   ├── types.ts              # TypeScript type definitions
│   ├── connection-manager.ts # Connection tracking
│   └── message-router.ts     # Message routing logic
├── tests/
│   └── test-client.ts        # Test client
├── package.json              # Project configuration
├── tsconfig.json             # TypeScript configuration
├── WS_TODOS.md              # Implementation roadmap
├── WEBSOCKET_IMPLEMENTATION.md # Detailed documentation
└── README.md                 # This file
```

## 📚 Documentation

- **[WEBSOCKET_IMPLEMENTATION.md](./WEBSOCKET_IMPLEMENTATION.md)** - Complete implementation details and usage examples
- **[WS_TODOS.md](./WS_TODOS.md)** - Full feature roadmap and next steps
- **[AGENTS.md](./AGENTS.md)** - Agent collaboration notes

## 🔌 Quick Example

### Mobile Client (Producer)

```typescript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "register",
    clientType: "mobile",
    streamId: "my-stream",
    produces: ["video-frame"],
    consumes: ["alert"]
  }));
};

// Send video frame
ws.send(JSON.stringify({
  type: "video-frame",
  streamId: "my-stream",
  data: "base64_encoded_frame",
  timestamp: Date.now()
}));
```

### Dashboard (Consumer)

```typescript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "subscribe",
    clientType: "dashboard",
    streamId: "my-stream",
    consumes: ["video-frame", "alert"]
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "video-frame") {
    // Display video
  } else if (msg.type === "alert") {
    // Show alert
  }
};
```

## 🛠️ Built With

- **[Bun](https://bun.sh)** - Fast all-in-one JavaScript runtime
- **TypeScript** - Type safety
- **Native WebSocket** - No external dependencies!

## 📊 Status

✅ **Core WebSocket Infrastructure** - Complete  
🚧 **REST API Endpoints** - Next priority  
🚧 **Authentication** - Planned  
🚧 **Database Integration** - Planned  

See [WS_TODOS.md](./WS_TODOS.md) for the complete roadmap.

## 📈 Performance

- Native Bun WebSocket (written in Zig)
- Built-in compression
- Concurrent connections limited only by system resources
- 16MB max payload size
- 2-minute idle timeout

## 🧪 Test Results

✅ All tests passing  
✅ Video streaming working  
✅ Alert broadcasting working  
✅ Connection management working  
✅ Status updates working  

## 📄 License

Private project

---

Built with ❤️ using [Bun](https://bun.sh)
