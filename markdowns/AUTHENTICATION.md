# Better Auth Integration Guide

This WebSocket server is fully integrated with Better Auth, using the same database as your Next.js application for authentication.

## Overview

All WebSocket connections **must** be authenticated. The server validates session tokens before accepting connections.

## How It Works

1. **User authenticates** in your Next.js app using Better Auth
2. **Client obtains** a session token from Better Auth
3. **Client connects** to WebSocket with the token
4. **Server validates** the token against the shared database
5. **Connection accepted** if token is valid

## Configuration

### 1. Environment Variables

Create a `.env` file with your database connection:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/watchout
PORT=3000
```

**Important**: Use the **same** `DATABASE_URL` as your Next.js app so the WebSocket server can access the Better Auth sessions.

### 2. Database Connection

The server uses Better Auth to verify sessions. Make sure:
- Your Next.js app and WebSocket server use the **same database**
- The `DATABASE_URL` environment variable is set correctly
- The database is accessible from the WebSocket server

### 3. Session Configuration

By default, the server looks for sessions using Better Auth's default cookie name: `better-auth.session_token`.

If your Next.js app uses a custom session cookie name, update `src/auth.ts`:

```typescript
export const auth = betterAuth({
  database: {
    type: "postgres",
    url: process.env.DATABASE_URL || "",
  },
  session: {
    cookieName: "your-custom-cookie-name", // Update this
    expiresIn: 60 * 60 * 24 * 7, // Must match Next.js config
  },
});
```

## Client Connection

### Authentication Methods

The server supports **three** methods for passing the session token:

#### Method 1: Query Parameter (Recommended for WebSocket)

```typescript
const token = "user-session-token-from-better-auth";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
```

#### Method 2: Authorization Header

```typescript
const ws = new WebSocket("ws://localhost:3000/ws", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

#### Method 3: Cookie (Automatic in Browser)

If connecting from a browser where the user is already logged in:

```typescript
// Cookie is automatically sent by the browser
const ws = new WebSocket("ws://localhost:3000/ws");
```

### Example: React/Next.js Client

```typescript
"use client";

import { useEffect, useState } from "react";

export function VideoStream() {
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Get session token from Better Auth
    // This assumes you have access to the session token
    // You might need to fetch it from your auth context or API
    const token = getSessionToken(); // Implement this based on your setup

    // Connect with authentication
    const websocket = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

    websocket.onopen = () => {
      console.log("Connected!");
      
      // Register as a mobile client producing video
      websocket.send(JSON.stringify({
        type: "register",
        clientType: "mobile",
        streamId: "my-stream-id",
        produces: ["video-frame"],
        consumes: ["alert"],
      }));
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received:", message);
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, []);

  return <div>WebSocket Status: {ws?.readyState === 1 ? "Connected" : "Disconnected"}</div>;
}
```

### Example: Mobile Client (React Native)

```typescript
import { useEffect } from "react";

export function useWebSocketConnection(sessionToken: string) {
  useEffect(() => {
    const ws = new WebSocket(`ws://your-server.com/ws?token=${sessionToken}`);

    ws.onopen = () => {
      // Register mobile device
      ws.send(JSON.stringify({
        type: "register",
        clientType: "mobile",
        streamId: `stream-${Date.now()}`,
        produces: ["video-frame"],
        consumes: ["alert"],
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === "alert") {
        // Handle alert from ML service
        console.log("Alert:", message);
      }
    };

    return () => ws.close();
  }, [sessionToken]);
}
```

## Getting the Session Token

### From Next.js App (Server-Side)

```typescript
import { auth } from "@/lib/auth"; // Your Better Auth instance

export async function getServerSideProps(context) {
  const session = await auth.api.getSession({
    headers: context.req.headers,
  });

  return {
    props: {
      sessionToken: session?.session.token || null,
    },
  };
}
```

### From Next.js App (Client-Side)

```typescript
"use client";

import { useSession } from "@/hooks/useSession"; // Assuming you have this

export function MyComponent() {
  const session = useSession();
  
  // Access the token from session
  const token = session?.token;
  
  // Use token to connect to WebSocket
  // ...
}
```

### From Cookies (Browser)

```typescript
function getSessionTokenFromCookie(): string | null {
  const cookies = document.cookie.split(";");
  
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "better-auth.session_token") {
      return value;
    }
  }
  
  return null;
}
```

## Security Considerations

### 1. Token Expiration

- Tokens expire based on your Better Auth configuration
- Default: 7 days
- Server will reject expired tokens with a 401 status

### 2. Token Storage

**Browser**: Stored in cookies (httpOnly recommended)
**Mobile**: Store in secure storage (e.g., Keychain, KeyStore)

**Never** store tokens in:
- localStorage (vulnerable to XSS)
- Plain text files
- Unencrypted storage

### 3. Connection Lifecycle

```
1. Client requests connection with token
2. Server validates token against database
3. Connection accepted if valid
4. User info stored in connection metadata
5. All messages are associated with authenticated user
6. Connection closed if token becomes invalid
```

### 4. Authorization

The server verifies **authentication** (who you are), but you may need to implement **authorization** (what you can do).

Edit `src/auth.ts` to add stream access control:

```typescript
export async function authorizeStreamAccess(
  userId: string,
  streamId: string,
  operation: "read" | "write"
): Promise<boolean> {
  // Example: Check if user owns the stream
  const stream = await db.query.streams.findFirst({
    where: eq(streams.id, streamId),
  });
  
  if (!stream) return false;
  
  if (operation === "write") {
    // Only stream owner can publish
    return stream.ownerId === userId;
  }
  
  if (operation === "read") {
    // Check if stream is public or user has access
    return stream.isPublic || stream.ownerId === userId || 
           await checkUserHasAccess(userId, streamId);
  }
  
  return false;
}
```

Then use it in your message handlers:

```typescript
// In message-router.ts
private async handleRegister(ws, message) {
  const metadata = ws.data;
  
  // Check if user can publish to this stream
  const canPublish = await authorizeStreamAccess(
    metadata.userId,
    message.streamId,
    "write"
  );
  
  if (!canPublish) {
    this.sendError(ws, "UNAUTHORIZED", "No permission to publish to this stream");
    return;
  }
  
  // Continue with registration...
}
```

## Troubleshooting

### Connection Rejected: No Authentication Token

**Cause**: Token not provided or in wrong format

**Solution**: Ensure token is passed via query parameter, header, or cookie

```typescript
// ✅ Correct
ws://localhost:3000/ws?token=abc123

// ❌ Wrong
ws://localhost:3000/ws
```

### Connection Rejected: Invalid or Expired Token

**Cause**: Token is invalid or session expired

**Solution**:
1. Check if user is logged in to Next.js app
2. Verify token is current (not expired)
3. Ensure DATABASE_URL matches Next.js app
4. Check Better Auth session configuration matches

### WebSocket Upgrade Failed

**Cause**: Server couldn't upgrade the connection

**Solution**:
1. Check server logs for errors
2. Verify network connectivity
3. Ensure WebSocket protocol is supported
4. Check for proxy/firewall issues

### Database Connection Errors

**Cause**: Can't connect to database

**Solution**:
1. Verify `DATABASE_URL` is correct
2. Check database is running
3. Ensure network access to database
4. Verify database credentials

## Testing

Use the test client to verify authentication:

```bash
# Set your session token
export SESSION_TOKEN="your-token-here"

# Run the test client
bun tests/test-client.ts
```

Or test manually:

```bash
# Get a session token from your Next.js app
# Then connect with curl (upgrade will fail, but you'll see auth response)
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  http://localhost:3000/ws
```

## Migration from Unauthenticated

If you had an existing unauthenticated server:

1. **Update clients** to pass session token
2. **Remove** old `userId` from message payloads (now automatic)
3. **Update** types - `userId` is now required in `ClientMetadata`
4. **Test** all clients work with authentication

### Before (Unauthenticated)

```typescript
ws.send(JSON.stringify({
  type: "register",
  userId: "user123", // Manually provided
  streamId: "stream1",
  clientType: "mobile",
}));
```

### After (Authenticated)

```typescript
// Connect with token
const ws = new WebSocket(`ws://localhost:3000/ws?token=${sessionToken}`);

ws.send(JSON.stringify({
  type: "register",
  // userId automatically extracted from token
  streamId: "stream1",
  clientType: "mobile",
}));
```

## Next Steps

1. ✅ Configure `DATABASE_URL` in `.env`
2. ✅ Update clients to pass session tokens
3. ✅ Test authentication flow
4. ⚠️ Implement authorization logic (if needed)
5. ⚠️ Add session refresh handling (if needed)
6. ⚠️ Set up monitoring for auth failures

## Support

For Better Auth documentation: https://www.better-auth.com/docs
For WebSocket issues: Check server logs and connection metadata
