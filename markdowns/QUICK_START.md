# Quick Start Guide

## TL;DR

The watchout-server is now set up with Better Auth authentication. Here's what you need to know:

## ✅ What's Done

1. **Database Integration**: Server connects to the same PostgreSQL database as watchout-web
2. **Session Verification**: Directly queries the session table to verify tokens
3. **No Secret Needed**: Better Auth uses database sessions, so no BETTER_AUTH_SECRET is required
4. **Environment Setup**: `.env` file created with DATABASE_URL

## 🚀 Start the Server

```bash
cd watchout-server
bun run dev
```

Server runs on: `ws://localhost:3000/ws`

## 🔑 How Authentication Works

```
1. User logs into watchout-web (Next.js) via Google/GitHub OAuth
   └─→ Better Auth creates session in PostgreSQL

2. Client (web or mobile) gets session token
   └─→ Token is stored in cookie (web) or secure storage (mobile)

3. Client connects to WebSocket with token
   └─→ ws://localhost:3000/ws?token=SESSION_TOKEN

4. watchout-server verifies token
   └─→ Queries session table in PostgreSQL
   └─→ Checks expiration
   └─→ Accepts or rejects connection
```

## 📱 What You Need to Do Next

### For Web Client (watchout-web)

If the web app needs to connect to WebSocket:

```typescript
// Get token from cookie
const token = document.cookie
  .split(';')
  .find(c => c.includes('better-auth.session_token'))
  ?.split('=')[1];

// Connect
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
```

### For Mobile Client (watchout-mobile) ⚠️ **NOT DONE YET**

The mobile app needs:
1. **OAuth integration** with watchout-web
2. **Session token storage** (use expo-secure-store)
3. **WebSocket connection** with token

See `MOBILE_AUTH_SETUP.md` for detailed instructions (estimated 7-11 hours of work).

## 🔧 Configuration

### Environment Variables

Only one required: `DATABASE_URL`

```env
# Same as watchout-web
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/watchout
```

### Files Created/Modified

**Created:**
- `src/db/client.ts` - Database connection
- `src/db/schema.ts` - Better Auth table definitions
- `.env` - Environment config
- `SETUP.md` - Detailed setup guide
- `MOBILE_AUTH_SETUP.md` - Mobile auth implementation guide

**Modified:**
- `src/auth.ts` - Now uses direct DB queries
- `package.json` - Added drizzle-orm, @neondatabase/serverless

## 🐛 Troubleshooting

### Connection Rejected: No Authentication Token
```bash
# Make sure you're passing the token:
ws://localhost:3000/ws?token=YOUR_TOKEN
```

### Connection Rejected: Invalid or Expired Token
```bash
# Get a fresh token by logging into watchout-web
# Check the session table:
psql $DATABASE_URL -c "SELECT id, token, expires_at FROM session LIMIT 5;"
```

### Database Connection Error
```bash
# Verify database is running:
docker ps | grep postgres

# Test connection:
psql $DATABASE_URL -c "SELECT 1;"
```

## 📚 Documentation

- **SETUP.md**: Complete setup and configuration guide
- **MOBILE_AUTH_SETUP.md**: Mobile client authentication implementation
- **AUTHENTICATION.md**: Better Auth integration details (existing)
- **WEBSOCKET_IMPLEMENTATION.md**: WebSocket protocol and message types

## 🎯 Next Steps Priority

1. **HIGH**: Implement mobile authentication (MOBILE_AUTH_SETUP.md)
2. **MEDIUM**: Add stream authorization (who can access which streams)
3. **MEDIUM**: Add session monitoring and alerts
4. **LOW**: Implement session refresh for long-lived connections
5. **LOW**: Add rate limiting per user

## 💡 Notes

### Why Direct DB Access?

We query the session table directly instead of calling the Next.js API because:
- **Lower latency**: No HTTP round trip
- **Simpler**: No need to expose auth endpoints
- **More reliable**: No dependency on Next.js being up
- **Better Auth design**: Built for shared database access

### Do I Need BETTER_AUTH_SECRET?

**No**, because:
- Better Auth is configured with database sessions (not JWT)
- Sessions are verified by querying the database
- Only the database URL needs to be shared

If you switch to JWT sessions in the future, you'll need to share the secret.

### Production Considerations

Before deploying:
1. Use HTTPS for watchout-web (TLS/SSL)
2. Use WSS for watchout-server (WebSocket Secure)
3. Use a managed PostgreSQL instance (not docker-compose)
4. Set up proper CORS and security headers
5. Add rate limiting
6. Set up monitoring and logging
7. Use environment variables for all secrets
8. Test authentication flow thoroughly

## 🆘 Need Help?

1. Check server logs: `bun run dev` shows authentication attempts
2. Check database: Query the session table to see active sessions
3. Test with curl: See SETUP.md for curl examples
4. Review Better Auth docs: https://www.better-auth.com/docs
