# Watchout Server Setup Guide

## Overview

The watchout-server is a WebSocket server built with Bun that handles real-time video streaming and authentication. It integrates with Better Auth from your Next.js app (watchout-web) by sharing the same PostgreSQL database.

## Authentication Architecture

### How It Works

1. **Shared Database**: Both watchout-web (Next.js) and watchout-server (Bun) connect to the same PostgreSQL database
2. **Better Auth Sessions**: When users log in via watchout-web, Better Auth creates session records in the database
3. **Session Verification**: The watchout-server verifies WebSocket connections by querying the session table directly
4. **No Shared Secret Needed**: Since we're using database-backed sessions (not JWT tokens), we don't need to share a BETTER_AUTH_SECRET between services

### Why No BETTER_AUTH_SECRET?

Better Auth supports two session strategies:
- **Database sessions** (what we're using): Sessions are stored in the database with a token. Any service with database access can verify sessions.
- **JWT sessions**: Would require a shared secret to sign/verify tokens.

Since watchout-web uses database sessions (configured via Drizzle adapter), the watchout-server only needs the `DATABASE_URL` to verify sessions.

## Setup Instructions

### 1. Install Dependencies

```bash
cd watchout-server
bun install
```

### 2. Configure Environment Variables

The `.env` file has been created for you with the local database connection:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/watchout
PORT=3000
```

**IMPORTANT**: If your Next.js app uses a different database (e.g., Neon, Supabase, AWS RDS), you MUST update the `DATABASE_URL` to match exactly.

### 3. Ensure Database is Running

If using local PostgreSQL with docker-compose (from watchout-web):

```bash
cd ../watchout-web
docker-compose up -d
```

If using a hosted database, make sure it's accessible from your machine.

### 4. Start the Server

```bash
bun run dev
```

The server will start on `ws://localhost:3000/ws`

## Testing Authentication

### Get a Session Token

You have two options to get a session token for testing:

#### Option 1: From Browser Console (if logged into watchout-web)

```javascript
// In your browser console while on watchout-web
document.cookie.split(';')
  .find(c => c.trim().startsWith('better-auth.session_token='))
  ?.split('=')[1]
```

#### Option 2: From Better Auth API

```bash
# First, log in via the web app, then:
curl http://localhost:3001/api/auth/session \
  -H "Cookie: better-auth.session_token=YOUR_TOKEN"
```

### Test WebSocket Connection

```javascript
// In browser console or Node.js
const token = "YOUR_SESSION_TOKEN_HERE";
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => {
  console.log("Connected!");
  
  // Register as a client
  ws.send(JSON.stringify({
    type: "register",
    clientType: "mobile",
    streamId: "test-stream",
    produces: ["video-frame"],
    consumes: ["alert"]
  }));
};

ws.onmessage = (event) => {
  console.log("Message:", JSON.parse(event.data));
};

ws.onerror = (error) => {
  console.error("Error:", error);
};
```

## Client Integration

### Web Client (watchout-web)

If your Next.js app needs to connect to the WebSocket server:

```typescript
"use client";

import { useEffect } from "react";

export function useVideoStream() {
  useEffect(() => {
    // Get session token from cookie
    const getSessionToken = () => {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'better-auth.session_token') {
          return value;
        }
      }
      return null;
    };

    const token = getSessionToken();
    if (!token) {
      console.error("No session token found");
      return;
    }

    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "register",
        clientType: "dashboard",
        streamId: "viewer-stream",
        produces: [],
        consumes: ["video-frame", "alert"]
      }));
    };

    return () => ws.close();
  }, []);
}
```

### Mobile Client (watchout-mobile)

The mobile client needs to authenticate with watchout-web first, then use the session token to connect to the WebSocket server.

**Key Points:**
1. The mobile app is currently standalone and not connected to Better Auth
2. You'll need to make the mobile app authenticate via the Next.js auth endpoints
3. Once authenticated, store the session token securely on the device
4. Use that token to connect to the WebSocket server

See `MOBILE_AUTH_SETUP.md` for detailed instructions on integrating the mobile client with Better Auth.

## Files Modified/Created

### Created:
- `src/db/client.ts` - Database connection using Drizzle ORM and Neon
- `src/db/schema.ts` - Better Auth table schemas (user, session, account, verification)
- `.env` - Environment variables with DATABASE_URL

### Modified:
- `src/auth.ts` - Updated to use direct database queries instead of API calls
- `package.json` - Added drizzle-orm and @neondatabase/serverless dependencies
- `.env.example` - Documented required environment variables

## Troubleshooting

### "DATABASE_URL is not set" Error

Make sure `.env` file exists and contains the DATABASE_URL:
```bash
cat .env
```

### "No session found for token"

- Check that the token is valid and not expired
- Verify the database URL matches your Next.js app
- Ensure the user is logged in to the Next.js app
- Check database connectivity

### "Session has expired"

Sessions expire based on Better Auth configuration. Have the user log in again to get a fresh token.

### Type Errors

Run type checking:
```bash
bun run type-check
```

## Next Steps

1. ✅ Authentication is set up and working
2. ✅ Database connection configured
3. ⚠️ Need to set up mobile client authentication (see MOBILE_AUTH_SETUP.md)
4. ⚠️ Consider implementing authorization (who can access which streams)
5. ⚠️ Add monitoring for authentication failures
6. ⚠️ Consider session refresh mechanism for long-lived connections

## Database Schema

The watchout-server uses the following Better Auth tables:

- **user**: Stores user information (id, name, email, etc.)
- **session**: Stores active sessions with tokens and expiration
- **account**: Stores OAuth provider accounts
- **verification**: Stores email verification tokens

All tables are created and managed by Better Auth via the Next.js app.
