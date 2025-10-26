# Secure Mobile Authentication Pattern

## Overview

The WebSocket server uses a **secure initial-message authentication pattern** designed specifically for mobile apps. This avoids security issues with tokens in URLs while remaining compatible with React Native's WebSocket implementation.

## Why This Pattern?

### ❌ Problems with Other Approaches:

1. **Token in URL** (`ws://server?token=xxx`)
   - Logged in server logs, proxy logs, browser history
   - Can leak in error messages or monitoring tools
   - Not secure for production

2. **Custom Headers**
   - React Native's WebSocket doesn't support custom headers reliably
   - Browser WebSocket API doesn't support headers at all
   - Platform-dependent behavior

3. **Cookies**
   - Awkward in mobile apps
   - Require webview workarounds
   - Cross-domain issues

### ✅ Our Solution: Initial Message Authentication

1. Connect to WebSocket **without** authentication
2. Server allows connection but marks as `authenticated: false`
3. Client **immediately** sends auth message with token (over encrypted WebSocket)
4. Server verifies token, updates connection to `authenticated: true`
5. All subsequent operations require authentication

## Security Benefits

- ✅ **Token never in URL** - no logging/history exposure
- ✅ **Encrypted in transit** - token sent over WSS in production
- ✅ **Platform agnostic** - works on iOS, Android, web
- ✅ **Simple client implementation** - standard WebSocket API
- ✅ **Server-side enforcement** - all operations blocked until auth
- ✅ **Auto-disconnect on auth failure** - connection closed if token invalid

## Connection Flow

```
1. Mobile App                          2. WebSocket Server
   │                                      │
   ├─ Connect WS ─────────────────────────▶ Accept (unauthenticated)
   │  ws://server/streams/register         │
   │                                        │
   ├─ Send auth message ──────────────────▶ Verify token
   │  { type: "auth", token: "xxx" }       │
   │                                        │
   │◀──── Success ──────────────────────── Mark authenticated
   │  { type: "success", ... }              │
   │                                        │
   ├─ Send register message ──────────────▶ Process (auth required ✓)
   │  { type: "register", ... }             │
   │                                        │
   ├─ Send video frames ──────────────────▶ Broadcast (auth required ✓)
   │  { type: "video-frame", ... }          │
   │                                        │
   │◀──── Receive alerts ──────────────────┤
   │  { type: "alert", ... }                │
```

## Expo/React Native Implementation

### 1. Install Dependencies

```bash
npm install expo-secure-store
```

### 2. Auth Service (`services/auth.ts`)

```typescript
import * as SecureStore from 'expo-secure-store';

const NEXT_APP_URL = 'http://localhost:3001'; // Your Next.js app

export class AuthService {
  // Securely store session token
  static async storeToken(token: string): Promise<void> {
    await SecureStore.setItemAsync('session_token', token);
  }

  // Get stored token
  static async getToken(): Promise<string | null> {
    return await SecureStore.getItemAsync('session_token');
  }

  // OAuth login via Better Auth
  static async loginWithOAuth(provider: 'google' | 'github'): Promise<string> {
    // Implementation depends on your Better Auth setup
    // This is a simplified example
    
    // Option 1: Get token from Next.js after OAuth
    const redirectUrl = Linking.createURL('auth-callback');
    const authUrl = `${NEXT_APP_URL}/api/auth/signin/${provider}`;
    
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    
    if (result.type === 'success') {
      // Your Next.js app should redirect with token
      const url = new URL(result.url);
      const token = url.searchParams.get('token');
      
      if (token) {
        await this.storeToken(token);
        return token;
      }
    }
    
    throw new Error('OAuth failed');
  }

  // Clear token on logout
  static async logout(): Promise<void> {
    await SecureStore.deleteItemAsync('session_token');
  }
}
```

### 3. WebSocket Client (`services/wsClient.ts`)

```typescript
import { AuthService } from './auth';

export class StreamClient {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private readonly WS_URL = __DEV__ 
    ? 'ws://localhost:3000' 
    : 'wss://your-production-domain.com';

  /**
   * Connect and authenticate
   */
  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const token = await AuthService.getToken();
      
      if (!token) {
        reject(new Error('Not logged in'));
        return;
      }

      // 1. Connect WITHOUT token in URL (secure!)
      this.ws = new WebSocket(`${this.WS_URL}/streams/register`);

      this.ws.onopen = () => {
        console.log('Connected - sending authentication...');
        
        // 2. IMMEDIATELY send auth message with token
        this.ws!.send(JSON.stringify({
          type: 'auth',
          token: token,
        }));
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'success' && !this.authenticated) {
          // 3. Authentication succeeded!
          console.log('Authenticated successfully');
          this.authenticated = true;
          resolve();
          
          // 4. Now register as video producer
          this.register();
        } else if (message.type === 'error' && !this.authenticated) {
          // Authentication failed
          console.error('Auth failed:', message.message);
          reject(new Error(message.message));
          this.ws?.close();
        } else {
          // Handle other messages
          this.handleMessage(message);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.authenticated = false;
      };
    });
  }

  /**
   * Register as video producer (only after authenticated)
   */
  private register(): void {
    if (!this.ws || !this.authenticated) return;

    this.ws.send(JSON.stringify({
      type: 'register',
      streamId: `mobile-${Date.now()}`,
      clientType: 'mobile',
      produces: ['video-frame'],
      consumes: ['alert'],
    }));
  }

  /**
   * Send video frame (only after authenticated)
   */
  sendVideoFrame(frameData: string): void {
    if (!this.ws || !this.authenticated) {
      console.error('Cannot send frame - not authenticated');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'video-frame',
      data: frameData,
      timestamp: Date.now(),
    }));
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'alert':
        console.log('Security alert:', message.message);
        // Show notification to user
        break;
      
      case 'status':
        console.log('Stream status:', message.status);
        break;
      
      case 'error':
        console.error('Server error:', message.message);
        break;
    }
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.ws?.close();
    this.authenticated = false;
  }
}
```

### 4. Usage in Your App

```typescript
import { StreamClient } from './services/wsClient';
import { AuthService } from './services/auth';

// In your component
const streamClient = new StreamClient();

// After user logs in with OAuth
async function startStreaming() {
  try {
    // 1. User logs in (get token from Better Auth)
    const token = await AuthService.loginWithOAuth('google');
    
    // 2. Connect to WebSocket (will auto-authenticate)
    await streamClient.connect();
    
    // 3. Start streaming video
    // streamClient.sendVideoFrame(...) will now work
    
  } catch (error) {
    console.error('Failed to start streaming:', error);
  }
}
```

## Server-Side Security

The server enforces authentication at multiple levels:

### 1. Connection State Tracking

```typescript
interface ClientMetadata {
  authenticated: boolean;  // Tracks auth state
  userId?: string;         // Set after auth
  sessionId?: string;      // Set after auth
  // ...
}
```

### 2. Auth Message Handler

```typescript
// Verifies token and updates connection
case "auth":
  const session = await verifySessionToken(message.token);
  if (!session) {
    ws.close(1008, "Authentication failed");
    return;
  }
  ws.data.authenticated = true;
  ws.data.userId = session.userId;
  // ...
```

### 3. Operation Guards

Every operation checks authentication:

```typescript
private async handleRegister(ws, message) {
  if (!ws.data.authenticated) {
    this.sendError(ws, "AUTH_REQUIRED", "Must authenticate first");
    return;
  }
  // Process registration...
}
```

### 4. Auto-Disconnect on Failure

Invalid tokens result in immediate disconnection:

```typescript
if (!session) {
  ws.close(1008, "Authentication failed");
  return;
}
```

## Message Sequence

### Successful Connection
```
Client → Server: [WebSocket Connection]
Server → Client: [Connection Accepted]

Client → Server: { type: "auth", token: "abc123..." }
Server: [Verifies token against database]
Server → Client: { type: "success", message: "Authentication successful" }

Client → Server: { type: "register", streamId: "...", ... }
Server → Client: { type: "success", message: "Registration successful. Stream ID: ..." }

Client → Server: { type: "video-frame", data: "...", ... }
Server → [Broadcasts to consumers]

Server → Client: { type: "alert", severity: "high", ... }
```

### Failed Authentication
```
Client → Server: [WebSocket Connection]
Server → Client: [Connection Accepted]

Client → Server: { type: "auth", token: "invalid_token" }
Server: [Token verification fails]
Server → Client: { type: "error", code: "AUTH_FAILED", message: "Invalid or expired token" }
Server: [Closes connection with code 1008]
```

### Attempting Operation Before Auth
```
Client → Server: [WebSocket Connection]
Server → Client: [Connection Accepted]

Client → Server: { type: "register", ... }  [NO AUTH MESSAGE!]
Server → Client: { type: "error", code: "AUTH_REQUIRED", message: "Must authenticate first" }
```

## Production Checklist

### Required for Production:

- [ ] **Use WSS (WebSocket Secure)**
  ```typescript
  const WS_URL = 'wss://your-domain.com';
  ```

- [ ] **Use expo-secure-store for tokens**
  ```typescript
  import * as SecureStore from 'expo-secure-store';
  ```

- [ ] **Implement token refresh**
  ```typescript
  // Check token expiry and refresh before connecting
  ```

- [ ] **Add connection timeout**
  ```typescript
  setTimeout(() => {
    if (!this.authenticated) {
      reject(new Error('Authentication timeout'));
      this.ws?.close();
    }
  }, 5000); // 5 second timeout
  ```

- [ ] **Handle reconnection**
  ```typescript
  async reconnect() {
    await this.disconnect();
    await this.connect();
  }
  ```

- [ ] **Add error monitoring**
  ```typescript
  // Log auth failures to your analytics
  ```

## Security Considerations

### ✅ What's Secure:

1. **Token in message body** - encrypted over WSS
2. **Server-side validation** - every token verified against database
3. **Connection state tracking** - operations blocked until auth
4. **Auto-disconnect on failure** - no lingering unauthorized connections
5. **Session expiration** - tokens expire, require re-auth

### ⚠️ Additional Security Measures:

1. **Rate limiting** - prevent brute force token attempts
2. **IP whitelisting** - restrict connections by IP (if needed)
3. **Token rotation** - refresh tokens periodically
4. **Audit logging** - log all auth attempts
5. **Connection limits** - max connections per user

## Comparison with Original Pattern

| Aspect | Token in URL | Initial Message Auth |
|--------|--------------|---------------------|
| Security | ❌ Logged everywhere | ✅ Encrypted in message |
| Mobile Support | ⚠️ Works but insecure | ✅ Native support |
| Browser Support | ⚠️ Works but insecure | ✅ Full support |
| Implementation | ✅ Simple | ✅ Simple |
| Production Ready | ❌ No | ✅ Yes |

## FAQ

**Q: Why not authenticate during upgrade like before?**
A: React Native WebSocket doesn't support custom headers reliably, and tokens in URLs are insecure.

**Q: What if someone connects but never sends auth?**
A: Server accepts connection but blocks all operations. Connection will timeout after 120 seconds (idle timeout).

**Q: Can someone send fake auth messages?**
A: No - server verifies every token against the database. Invalid tokens result in immediate disconnection.

**Q: What about token refresh?**
A: Check token expiry before connecting. If expired, refresh via your Next.js API, then connect.

**Q: Is this slower than auth-during-upgrade?**
A: Negligible difference (<50ms). The extra roundtrip is worth the security improvement.

## Summary

This pattern provides **secure, mobile-friendly authentication** for WebSocket connections:

- ✅ No tokens in URLs (secure)
- ✅ Works on all platforms (compatible)
- ✅ Simple client implementation (developer-friendly)
- ✅ Strong server-side enforcement (robust)
- ✅ Production-ready (scalable)

Your Expo app can now safely connect to the WebSocket server with full OAuth integration from Better Auth!
