<div align="center">
    <img src="https://raw.githubusercontent.com/spineda1208/watchout/main/.github/images/logo.png" width="100rem" height="100rem"/>
</div>

High-performance WebSocket server for real-time video streaming and alert broadcasting, built with [Bun](https://bun.sh)'s native APIs.

## Dependencies

- **bun** >= 1.3.1

## Getting Started

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

- Mobile clients: `ws://localhost:3000/streams/register`
- Web app: `ws://localhost:3000/streams/subscribe`
- Health check: `http://localhost:3000/health`
- Stats: `http://localhost:3000/stats`

## Architecture

This is a **pure stream router** that manages WebSocket connections in memory and routes video/alert data between clients.

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

### How It Works

**Key Points:**

- All stream state is kept **in memory only** (no database persistence)
- Authentication via Better Auth (session verification only)
- Separate WebSocket endpoints for mobile and web app
- ML service does NOT connect to us - we push frames TO it
- Alerts from ML service are broadcast to mobile + web app in real-time

**Video Streaming Flow:**

1. Mobile connects to `/streams/register`
2. Mobile sends "register" message
3. Server responds with success + streamId
4. Mobile starts sending "video-frame" messages
5. Server broadcasts frames to:
   - All WebSocket subscribers (web app at `/streams/subscribe`)
   - TODO: ML service (WE push TO ML service via HTTP/WebSocket/Queue)
6. Web app receives frames in real-time

**Alert Flow (Future):**

1. WE push video frames TO ML service (initiated by us)
2. ML service analyzes and detects anomaly
3. ML service sends alert back TO US (via HTTP POST or WebSocket we initiated)
4. Server broadcasts alert to:
   - Mobile client (via `/streams/register` connection)
   - Web app (via `/streams/subscribe` connection)
5. Alert persistence handled by separate service

## Documentation

For complete API documentation, message types, and integration examples, see:

- **[STREAM_ROUTER_API.md](./STREAM_ROUTER_API.md)** - Complete API reference and integration guide

## Built With

- **[Bun](https://bun.sh)** - Fast all-in-one JavaScript runtime
- **[Better Auth](https://better-auth.com)** - Modern authentication
- **TypeScript** - Type safety
- **Native WebSocket** - Minimal dependencies

## Performance

- Native Bun WebSocket (written in Zig)
- Built-in compression
- Concurrent connections limited only by system resources
- 16MB max payload size
- 2-minute idle timeout

---

Built with ❤️ using [Bun](https://bun.sh)
