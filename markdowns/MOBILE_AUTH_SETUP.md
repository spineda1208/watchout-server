# Mobile Client Authentication Setup

## Current Situation

The watchout-mobile React Native app is currently **not integrated** with the Better Auth authentication system. It needs to:

1. Authenticate users via the Next.js (watchout-web) auth endpoints
2. Store session tokens securely on the device
3. Use those tokens to connect to the watchout-server WebSocket

## Architecture Overview

```
┌──────────────────┐
│  watchout-mobile │
│  (React Native)  │
└────────┬─────────┘
         │
         │ 1. OAuth Login
         │    (via web view or API)
         ▼
┌──────────────────┐
│  watchout-web    │
│  (Next.js)       │◄──── Better Auth handles auth
│  Port: 3001      │
└────────┬─────────┘
         │
         │ 2. Session Token
         │    stored in DB
         ▼
┌──────────────────┐
│   PostgreSQL     │
│   Database       │◄──── Shared session storage
└────────┬─────────┘
         │
         │ 3. WebSocket connection
         │    with token
         ▼
┌──────────────────┐
│ watchout-server  │
│  (Bun WS)        │
│  Port: 3000      │
└──────────────────┘
```

## Implementation Options

### Option 1: Headless OAuth Flow (Recommended)

Use Better Auth's API endpoints directly from the mobile app without opening a web view.

#### Pros:
- Native mobile experience
- Full control over UI
- No web view required

#### Cons:
- More complex to implement
- Need to handle OAuth redirects carefully

#### Implementation:

1. **Install Better Auth Client** (if available for React Native, or use fetch directly)

2. **Create Auth Service** in `watchout-mobile/src/services/auth.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://localhost:3001'; // Change for production

export class AuthService {
  /**
   * Initiate OAuth login
   * Returns the OAuth URL to open in a browser/web view
   */
  static async getOAuthUrl(provider: 'google' | 'github'): Promise<string> {
    const response = await fetch(`${API_URL}/api/auth/oauth/${provider}/authorize`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return data.url;
  }

  /**
   * Handle OAuth callback
   * Call this after user completes OAuth flow
   */
  static async handleOAuthCallback(code: string, state: string): Promise<string> {
    const response = await fetch(`${API_URL}/api/auth/oauth/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, state }),
    });

    if (!response.ok) {
      throw new Error('OAuth callback failed');
    }

    const data = await response.json();
    const sessionToken = data.session?.token;

    if (sessionToken) {
      await this.storeSessionToken(sessionToken);
    }

    return sessionToken;
  }

  /**
   * Store session token securely
   */
  static async storeSessionToken(token: string): Promise<void> {
    await AsyncStorage.setItem('session_token', token);
  }

  /**
   * Get stored session token
   */
  static async getSessionToken(): Promise<string | null> {
    return await AsyncStorage.getItem('session_token');
  }

  /**
   * Verify session is still valid
   */
  static async verifySession(token: string): Promise<boolean> {
    const response = await fetch(`${API_URL}/api/auth/session`, {
      headers: {
        'Cookie': `better-auth.session_token=${token}`,
      },
    });

    return response.ok;
  }

  /**
   * Sign out
   */
  static async signOut(): Promise<void> {
    const token = await this.getSessionToken();
    
    if (token) {
      await fetch(`${API_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          'Cookie': `better-auth.session_token=${token}`,
        },
      });
    }

    await AsyncStorage.removeItem('session_token');
  }
}
```

3. **Create Login Screen** in `watchout-mobile/src/screens/LoginScreen.tsx`:

```typescript
import React, { useState } from 'react';
import { View, Button, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { AuthService } from '../services/auth';

export function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    
    try {
      // Get OAuth URL from your Next.js backend
      const oauthUrl = await AuthService.getOAuthUrl('google');
      
      // Open OAuth in browser
      const result = await WebBrowser.openAuthSessionAsync(
        oauthUrl,
        Linking.createURL('/') // Your app's deep link
      );

      if (result.type === 'success') {
        // Extract code and state from the callback URL
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (code && state) {
          // Exchange code for session token
          await AuthService.handleOAuthCallback(code, state);
          onLoginSuccess();
        }
      }
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    // Similar to Google login
  };

  return (
    <View style={styles.container}>
      <Button
        title="Sign in with Google"
        onPress={handleGoogleLogin}
        disabled={isLoading}
      />
      <Button
        title="Sign in with GitHub"
        onPress={handleGithubLogin}
        disabled={isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
});
```

4. **Update WebSocket Connection** to use session token:

In `watchout-mobile/src/services/wsClient.ts`, modify the connection to include the token:

```typescript
import { AuthService } from './auth';

export class WSClient {
  private ws: WebSocket | null = null;

  async connect() {
    // Get session token from storage
    const token = await AuthService.getSessionToken();
    
    if (!token) {
      throw new Error('No session token found. Please log in.');
    }

    // Connect with token in URL
    const wsUrl = `ws://localhost:3000/ws?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.register();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
    };
  }

  private register() {
    if (!this.ws) return;

    this.ws.send(JSON.stringify({
      type: 'register',
      clientType: 'mobile',
      streamId: `mobile-${Date.now()}`,
      produces: ['video-frame'],
      consumes: ['alert'],
    }));
  }

  // ... rest of your existing WebSocket methods
}
```

### Option 2: Web View OAuth Flow (Simpler but Less Native)

Open the Next.js login page in a web view, then extract the session cookie.

#### Pros:
- Simpler to implement
- Leverages existing web UI
- Better Auth handles everything

#### Cons:
- Less native experience
- Need to extract cookies from web view
- Security considerations with cookie access

#### Implementation:

```typescript
import { WebView } from 'react-native-webview';

export function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const handleNavigationStateChange = async (navState: any) => {
    // Check if user completed login
    if (navState.url.includes('/dashboard') || navState.url.includes('/home')) {
      // Extract session cookie from web view
      const cookies = await WebView.CookieManager.get('http://localhost:3001');
      const sessionToken = cookies['better-auth.session_token'];
      
      if (sessionToken) {
        await AuthService.storeSessionToken(sessionToken);
        onLoginSuccess();
      }
    }
  };

  return (
    <WebView
      source={{ uri: 'http://localhost:3001/login' }}
      onNavigationStateChange={handleNavigationStateChange}
    />
  );
}
```

### Option 3: Email/Password Authentication

If you want to add email/password auth (not currently set up in Better Auth):

1. **Enable email/password** in `watchout-web/src/lib/auth.ts`:

```typescript
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
  },
  socialProviders: {
    // ... existing providers
  },
});
```

2. **Create mobile login form**:

```typescript
const handleEmailLogin = async (email: string, password: string) => {
  const response = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (response.ok) {
    const data = await response.json();
    const sessionToken = data.session?.token;
    await AuthService.storeSessionToken(sessionToken);
  }
};
```

## Required Dependencies

Add these to `watchout-mobile/package.json`:

```bash
npm install @react-native-async-storage/async-storage
npm install expo-web-browser  # For OAuth
npm install expo-linking      # For deep linking
```

## Configuration Changes Needed

### 1. Update `watchout-mobile/src/config/api.ts`:

```typescript
export const API_CONFIG = {
  // Change these for production
  AUTH_API_URL: __DEV__ ? 'http://localhost:3001' : 'https://your-production-domain.com',
  WS_URL: __DEV__ ? 'ws://localhost:3000' : 'wss://your-ws-domain.com',
};
```

### 2. Configure Deep Linking in `app.json`:

```json
{
  "expo": {
    "scheme": "watchout",
    "ios": {
      "bundleIdentifier": "com.watchout.app"
    },
    "android": {
      "package": "com.watchout.app"
    }
  }
}
```

### 3. Update Better Auth in `watchout-web` to allow mobile redirects:

```typescript
export const auth = betterAuth({
  // ... existing config
  trustedOrigins: [
    'http://localhost:3001',
    'exp://localhost:8081', // Expo dev
    'watchout://', // Your app scheme
  ],
});
```

## Security Considerations

### 1. Token Storage

**DO:**
- Use `@react-native-async-storage/async-storage` for simple apps
- Use `expo-secure-store` for production (encrypted storage)
- Use Keychain (iOS) / Keystore (Android) for maximum security

**DON'T:**
- Store tokens in plain text files
- Log tokens to console in production
- Store tokens in global variables

### 2. Token Refresh

Better Auth sessions expire after a configured time (default 7 days). Implement token refresh:

```typescript
export class AuthService {
  static async refreshSession(): Promise<boolean> {
    const token = await this.getSessionToken();
    
    if (!token) return false;

    const isValid = await this.verifySession(token);
    
    if (!isValid) {
      await this.signOut();
      return false;
    }

    return true;
  }
}
```

Call this on app startup and periodically during use.

### 3. HTTPS in Production

**CRITICAL:** Always use HTTPS for the auth API and WSS for WebSocket in production:

```typescript
const API_URL = process.env.NODE_ENV === 'production'
  ? 'https://your-domain.com'
  : 'http://localhost:3001';

const WS_URL = process.env.NODE_ENV === 'production'
  ? 'wss://your-ws-domain.com'
  : 'ws://localhost:3000';
```

## Testing Checklist

- [ ] User can log in via Google OAuth
- [ ] User can log in via GitHub OAuth
- [ ] Session token is stored securely
- [ ] WebSocket connects with valid token
- [ ] WebSocket rejects invalid/expired tokens
- [ ] User can log out
- [ ] Session persists across app restarts
- [ ] Session expires correctly
- [ ] Proper error handling for network failures

## Migration Steps

1. **Phase 1: Setup Auth Service** (1-2 hours)
   - Create `AuthService` class
   - Add secure storage for tokens
   - Test token storage/retrieval

2. **Phase 2: Build Login UI** (2-3 hours)
   - Create login screen
   - Implement OAuth flow (Option 1 or 2)
   - Test OAuth with Google/GitHub

3. **Phase 3: Integrate with WebSocket** (1 hour)
   - Update `WSClient` to use session token
   - Test authenticated WebSocket connections
   - Handle auth errors gracefully

4. **Phase 4: Add Session Management** (1-2 hours)
   - Implement session verification
   - Add logout functionality
   - Handle token expiration

5. **Phase 5: Testing & Polish** (2-3 hours)
   - Test all flows end-to-end
   - Add error handling
   - Improve UX with loading states

**Total Estimated Time: 7-11 hours**

## Resources

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [React Native OAuth Guide](https://docs.expo.dev/guides/authentication/)
- [Expo Secure Store](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [WebSocket Authentication](https://javascript.info/websocket#authentication)

## Questions to Answer

Before implementing, decide:

1. **Which OAuth providers?** (Currently: Google + GitHub)
2. **Email/password needed?** (Currently: No)
3. **Token storage strategy?** (Recommended: expo-secure-store)
4. **Session expiration handling?** (Recommended: Auto-refresh on app open)
5. **Offline support?** (Do you need offline video recording?)

## Support

If you encounter issues:
1. Check the Next.js auth API is accessible from mobile device
2. Verify database sessions are being created
3. Check WebSocket server logs for authentication errors
4. Test session token manually with curl/Postman
