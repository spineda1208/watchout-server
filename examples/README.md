# Example Clients

This directory contains example implementations for connecting to the Watchout streaming server.

## 🔐 Security Pattern

All examples use the **secure initial-message authentication pattern**:

1. ✅ Connect to WebSocket (NO token in URL)
2. ✅ Send auth message with token immediately
3. ✅ Wait for authentication success
4. ✅ Then proceed with operations

## 📱 Mobile Client Example

File: `mobile-client-example.ts`

Demonstrates:
- Video producer (sends video frames)
- Alert consumer (receives security alerts)
- Secure authentication flow
- Error handling

### Run:
```bash
# With test token
bun examples/mobile-client-example.ts

# With real token
SESSION_TOKEN="your_token_here" bun examples/mobile-client-example.ts
```

## 🖥️ Dashboard Client Example

File: `dashboard-client-example.ts`

Demonstrates:
- Video consumer (receives video frames)
- Alert consumer (receives security alerts)
- Stream status updates
- Secure authentication flow

### Run:
```bash
# Subscribe to specific stream
bun examples/dashboard-client-example.ts mobile-stream-12345

# With real token
SESSION_TOKEN="your_token_here" bun examples/dashboard-client-example.ts mobile-stream-12345
```

## 🧪 Testing Together

### Terminal 1 - Start Server:
```bash
bun src/index.ts
```

### Terminal 2 - Start Mobile Client:
```bash
bun examples/mobile-client-example.ts
```

### Terminal 3 - Start Dashboard Client:
```bash
# Use the stream ID from mobile client output
bun examples/dashboard-client-example.ts mobile-stream-XXXXX
```

You should see:
1. Mobile client connects and authenticates
2. Mobile client registers as video producer
3. Dashboard connects and authenticates
4. Dashboard subscribes to mobile's stream
5. Video frames flow from mobile → dashboard
6. (When ML service is connected) alerts flow back to both

## 🔑 Getting Real Tokens

In production, get tokens from your Better Auth OAuth flow:

### Option 1: Browser Console (for testing)
```javascript
// In your Next.js app
document.cookie.split(';')
  .find(c => c.includes('better-auth.session_token'))
  .split('=')[1]
```

### Option 2: API Call
```typescript
const response = await fetch('http://localhost:3001/api/auth/session', {
  credentials: 'include'
});
const data = await response.json();
console.log(data.session.token);
```

## 📚 Key Concepts

### Authentication Flow
```
Connect → Auth Message → Success → Register/Subscribe → Operations
```

### Message Types
- `auth` - Authentication (first message)
- `register` - Mobile client registration
- `subscribe` - Dashboard/ML subscription
- `video-frame` - Video data from mobile
- `alert` - Security alerts from ML
- `status` - Stream status updates
- `success` - Operation success
- `error` - Operation failure

### Error Codes
- `AUTH_REQUIRED` - Must authenticate first
- `AUTH_FAILED` - Invalid or expired token
- `ALREADY_AUTHENTICATED` - Already authenticated
- `UNKNOWN_MESSAGE_TYPE` - Invalid message type
- `ROUTING_ERROR` - Message routing failed

## 🚀 Production Considerations

When deploying:

1. **Use WSS** (secure WebSocket):
   ```typescript
   const ws = new WebSocket('wss://your-domain.com/streams/register');
   ```

2. **Store tokens securely**:
   ```typescript
   // React Native
   import * as SecureStore from 'expo-secure-store';
   await SecureStore.setItemAsync('session_token', token);
   
   // Browser
   // Tokens in httpOnly cookies (handled by browser)
   ```

3. **Handle reconnection**:
   ```typescript
   ws.onclose = () => {
     setTimeout(() => this.connect(), 5000); // Retry after 5s
   };
   ```

4. **Add timeouts**:
   ```typescript
   const authTimeout = setTimeout(() => {
     if (!this.authenticated) {
       ws.close();
       reject(new Error('Authentication timeout'));
     }
   }, 5000);
   ```

5. **Monitor connection state**:
   ```typescript
   setInterval(() => {
     if (ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify({ type: 'ping' }));
     }
   }, 30000); // Ping every 30s
   ```

## 🛠️ Adapting for Your Language

These examples are in TypeScript, but the pattern works in any language:

### Python
```python
import websocket
import json

ws = websocket.create_connection("ws://localhost:3000/streams/register")
ws.send(json.dumps({"type": "auth", "token": token}))
response = json.loads(ws.recv())
```

### Swift (iOS)
```swift
let ws = WebSocket(url: URL(string: "ws://localhost:3000/streams/register")!)
ws.connect()
ws.write(string: "{\"type\":\"auth\",\"token\":\"\(token)\"}")
```

### Kotlin (Android)
```kotlin
val ws = OkHttpClient().newWebSocket(request) { ... }
ws.send("{\"type\":\"auth\",\"token\":\"$token\"}")
```

## 📞 Support

Questions? Check:
- `../markdowns/SECURE_MOBILE_AUTH.md` - Full authentication guide
- `../markdowns/API_DOCUMENTATION.md` - API reference
- `../prompt.txt` - AI integration guide
