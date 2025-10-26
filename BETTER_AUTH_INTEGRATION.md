# Better Auth Integration - Implementation Summary

## ✅ Completed Integration

Your WebSocket server is now fully integrated with Better Auth! All connections are authenticated using the same database as your Next.js application.

## 🔑 What Was Done

### 1. Authentication Layer (`src/auth.ts`)
- ✅ Token extraction from multiple sources (query params, headers, cookies)
- ✅ Session verification via Next.js API or direct database query
- ✅ User info extraction and validation
- ✅ Authorization hooks (ready for stream access control)

### 2. WebSocket Server (`src/index.ts`)
- ✅ Authentication check before WebSocket upgrade
- ✅ 401 rejection for missing/invalid tokens
- ✅ Session data stored in connection metadata
- ✅ Authenticated user info available throughout connection lifecycle

### 3. Type System (`src/types.ts`)
- ✅ `ClientMetadata` now includes required `userId` and `sessionId`
- ✅ Added optional `userEmail` and `userName` fields
- ✅ Removed manual `userId` from message payloads (auto-populated)
- ✅ Updated `RegisterMessage` and `SubscribeMessage` types

### 4. Message Router (`src/message-router.ts`)
- ✅ Uses authenticated user info from connection data
- ✅ No longer accepts `userId` from client messages
- ✅ Enhanced logging with user email/ID
- ✅ Validation that connections are authenticated

### 5. Documentation
- ✅ **AUTHENTICATION.md** - Complete authentication guide
- ✅ **README.md** - Updated with auth requirements
- ✅ **.env.example** - Environment configuration template
- ✅ **tests/test-client.ts** - Updated test client with auth

## 🚀 How to Use

### Setup (Do This Once)

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env`:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/watchout
   NEXT_PUBLIC_API_URL=http://localhost:3001  # Your Next.js app URL
   PORT=3000
   ```

3. **Choose authentication method** in `src/auth.ts`:

   **Option A: API Call** (default, simpler):
   - Uses your Next.js API endpoint
   - No database setup needed
   - Slightly higher latency
   
   **Option B: Direct Database** (faster):
   - Requires sharing Drizzle schema
   - Lower latency
   - Uncomment and configure in `src/auth.ts`

### Client Connection

**Before (Unauthenticated)**:
```typescript
const ws = new WebSocket("ws://localhost:3000/ws");
ws.send(JSON.stringify({
  type: "register",
  userId: "user123",  // Manual
  streamId: "stream1",
  clientType: "mobile",
}));
```

**After (Authenticated)**:
```typescript
// Get token from Better Auth session
const token = getSessionToken();

// Connect with token
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.send(JSON.stringify({
  type: "register",
  // userId is automatic from token
  streamId: "stream1",
  clientType: "mobile",
}));
```

## 🔧 Configuration Options

### Authentication Method

Edit `src/auth.ts` and choose your verification method:

#### Method 1: Next.js API (Current)
```typescript
const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Cookie: `better-auth.session_token=${token}`,
  },
});
```

**Pros**: Simple, no database setup
**Cons**: Network overhead

#### Method 2: Direct Database Query (Recommended for Production)
```typescript
import { db } from "./db";
import { session, user } from "./schema";

const result = await db
  .select({
    sessionId: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
    email: user.email,
    name: user.name,
  })
  .from(session)
  .leftJoin(user, eq(session.userId, user.id))
  .where(eq(session.token, token))
  .limit(1);
```

**Pros**: Fast, no network overhead
**Cons**: Requires sharing database schema

### Token Passing Methods

Clients can pass tokens in three ways:

1. **Query Parameter** (Recommended for WebSocket):
   ```typescript
   ws://localhost:3000/ws?token=SESSION_TOKEN
   ```

2. **Authorization Header**:
   ```typescript
   new WebSocket("ws://localhost:3000/ws", {
     headers: { Authorization: "Bearer SESSION_TOKEN" }
   });
   ```

3. **Cookie** (Automatic in Browser):
   ```typescript
   // Cookie automatically sent by browser
   new WebSocket("ws://localhost:3000/ws");
   ```

## 🧪 Testing

### Manual Testing

1. **Get a session token** from your Next.js app:
   ```javascript
   // In browser console on your Next.js app
   document.cookie.split(';')
     .find(c => c.includes('better-auth.session_token'))
     .split('=')[1]
   ```

2. **Set token** and run test:
   ```bash
   export SESSION_TOKEN="your-token-here"
   bun tests/test-client.ts
   ```

### Integration Testing

```typescript
// tests/test-client.ts already updated with auth
const SESSION_TOKEN = process.env.SESSION_TOKEN || "";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${SESSION_TOKEN}`);
```

## 🔐 Security Features

### What's Protected
- ✅ WebSocket upgrade requires valid token
- ✅ Expired tokens rejected
- ✅ Invalid tokens rejected
- ✅ User identity verified against database
- ✅ Session info stored securely in connection

### What's NOT Yet Protected (TODO)
- ⚠️ Stream-level authorization (coming soon)
- ⚠️ Rate limiting per user
- ⚠️ Token refresh handling
- ⚠️ Connection limits per user

### Adding Authorization

To add stream access control, edit `src/auth.ts`:

```typescript
export async function authorizeStreamAccess(
  userId: string,
  streamId: string,
  operation: "read" | "write"
): Promise<boolean> {
  // Example: Check stream ownership
  const stream = await db.query.streams.findFirst({
    where: eq(streams.id, streamId),
  });
  
  if (!stream) return false;
  
  // Only owner can write
  if (operation === "write") {
    return stream.ownerId === userId;
  }
  
  // Anyone can read public streams
  if (operation === "read") {
    return stream.isPublic || stream.ownerId === userId;
  }
  
  return false;
}
```

Then use in message handlers:

```typescript
// In src/message-router.ts
private async handleRegister(ws, message) {
  const canWrite = await authorizeStreamAccess(
    ws.data.userId,
    message.streamId,
    "write"
  );
  
  if (!canWrite) {
    this.sendError(ws, "FORBIDDEN", "No access to this stream");
    return;
  }
  
  // Continue with registration...
}
```

## 📊 What Changed

### Breaking Changes
- ✅ **Authentication now required** - all connections must have valid token
- ✅ **`userId` is automatic** - no longer sent in messages
- ✅ **Types updated** - `userId` is required in `ClientMetadata`

### Migration Guide

If you have existing clients:

1. **Update connection**:
   ```diff
   - new WebSocket("ws://localhost:3000/ws")
   + new WebSocket(`ws://localhost:3000/ws?token=${token}`)
   ```

2. **Remove userId from messages**:
   ```diff
   {
     type: "register",
   - userId: "user123",
     streamId: "stream1",
     clientType: "mobile"
   }
   ```

3. **Handle 401 errors**:
   ```typescript
   ws.onerror = (error) => {
     // Token invalid or expired - refresh and reconnect
   };
   ```

## 🐛 Troubleshooting

### "Authentication required" (401)
**Problem**: No token provided
**Solution**: Pass token via query param, header, or cookie

### "Invalid or expired authentication token" (401)
**Problem**: Token is invalid or session expired
**Solution**: 
- Verify user is logged in to Next.js app
- Check token format
- Ensure DATABASE_URL is correct
- Verify Better Auth is running

### Type errors with `userId`
**Problem**: Old code expects optional `userId`
**Solution**: Update types - `userId` is now required in `ClientMetadata`

### WebSocket upgrade fails
**Problem**: Server can't verify token
**Solution**:
- Check `NEXT_PUBLIC_API_URL` in `.env`
- Verify Next.js app is running
- Check database connection

## 🎯 Next Steps

### Recommended
1. ✅ Test with real session tokens
2. ⚠️ Implement stream-level authorization
3. ⚠️ Add connection limits per user
4. ⚠️ Set up monitoring for auth failures

### Optional
- Token refresh handling
- Rate limiting
- IP-based access control
- Audit logging

## 📚 Related Documentation

- **[AUTHENTICATION.md](./AUTHENTICATION.md)** - Detailed authentication guide
- **[WEBSOCKET_IMPLEMENTATION.md](./WEBSOCKET_IMPLEMENTATION.md)** - WebSocket implementation details
- **[Better Auth Docs](https://better-auth.com)** - Better Auth documentation

## 🤝 Integration with Next.js

Your WebSocket server and Next.js app now share:
- ✅ Same database (via `DATABASE_URL`)
- ✅ Same Better Auth sessions
- ✅ Same user authentication
- ✅ Same session token format

This means:
- Users logged in to Next.js can connect to WebSocket
- WebSocket can access user data from database
- Sessions are synchronized
- No duplicate authentication logic

## ✨ Summary

**Authentication is complete!** 

Your WebSocket server now:
- ✅ Requires valid Better Auth tokens
- ✅ Verifies sessions against shared database
- ✅ Automatically extracts user info
- ✅ Rejects unauthorized connections
- ✅ Ready for stream-level authorization

All that's left is configuring your `.env` file and choosing your preferred authentication method (API call vs direct database query).
