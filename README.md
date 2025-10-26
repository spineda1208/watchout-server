<div align="center">
    <img src="https://raw.githubusercontent.com/spineda1208/watchout/main/.github/images/logo.png" width="100rem" height="100rem"/>
</div>

High-performance WebSocket server for real-time video streaming and alert broadcasting, built with [Bun](https://bun.sh)'s native APIs.

## 🎯 What is This?

This is a **bidirectional pub-sub relay system** that connects:

- 📱 **Mobile clients** - Stream video and receive alerts
- 🖥️ **Dashboard** - View video streams and receive alerts
- 🤖 **ML services** - Analyze video and send alerts

## ✨ Features

✅ Real-time video streaming (mobile → dashboard/ML)
✅ Alert broadcasting (ML → mobile/dashboard)
✅ **Better Auth integration** - Secure authentication
✅ Connection management and tracking
✅ Status updates (online, offline, streaming)
✅ Health check and statistics endpoints
✅ Type-safe with TypeScript
✅ Minimal dependencies (uses Bun's native WebSocket)
✅ Built-in message compression
✅ Supports up to 16MB payloads

## 🚀 Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your database URL (must match your Next.js app):

```env
DATABASE_URL=postgresql://user:password@localhost:5432/watchout
PORT=3000
```

### 3. Run the Server

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

### Start Here

- **[QUICK_START.md](./QUICK_START.md)** - ⚡ Quick start guide and TL;DR
- **[SETUP.md](./SETUP.md)** - 🔧 Complete setup and configuration

### Authentication

- **[AUTHENTICATION.md](./AUTHENTICATION.md)** - 🔐 Better Auth integration details
- **[MOBILE_AUTH_SETUP.md](./MOBILE_AUTH_SETUP.md)** - 📱 Mobile client authentication guide

### Implementation

- **[WEBSOCKET_IMPLEMENTATION.md](./WEBSOCKET_IMPLEMENTATION.md)** - Complete implementation details and usage examples
- **[WS_TODOS.md](./WS_TODOS.md)** - Full feature roadmap and next steps
- **[AGENTS.md](./AGENTS.md)** - Agent collaboration notes

## 🔌 Quick Example

### Mobile Client (Producer)

```typescript
// Connect with authentication token
const token = "your-better-auth-session-token";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "register",
      clientType: "mobile",
      streamId: "my-stream",
      produces: ["video-frame"],
      consumes: ["alert"],
    }),
  );
};

// Send video frame
ws.send(
  JSON.stringify({
    type: "video-frame",
    streamId: "my-stream",
    data: "base64_encoded_frame",
    timestamp: Date.now(),
  }),
);
```

### Dashboard (Consumer)

```typescript
// Connect with authentication token
const token = "your-better-auth-session-token";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "subscribe",
      clientType: "dashboard",
      streamId: "my-stream",
      consumes: ["video-frame", "alert"],
    }),
  );
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
- **[Better Auth](https://better-auth.com)** - Modern authentication
- **TypeScript** - Type safety
- **Native WebSocket** - Minimal dependencies!

## 📊 Status

✅ **Core WebSocket Infrastructure** - Complete
✅ **Authentication** - Complete (Better Auth integration)
✅ **Database Integration** - Complete (shared with Next.js)
🚧 **REST API Endpoints** - Next priority
🚧 **Authorization** - Planned (stream access control)

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
