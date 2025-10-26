/**
 * Mobile Client Example - Video Producer
 * 
 * This demonstrates how to connect a mobile app to the streaming server
 * with secure authentication.
 */

class MobileStreamClient {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private registered = false;
  private streamId: string;
  private token: string;

  constructor(streamId: string, token: string) {
    this.streamId = streamId;
    this.token = token;
  }

  /**
   * Connect to the server with secure authentication
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('📱 [Mobile] Connecting to WebSocket...');
      
      // IMPORTANT: Connect WITHOUT token in URL (secure!)
      this.ws = new WebSocket('ws://localhost:3000/streams/register');

      this.ws.onopen = () => {
        console.log('✅ [Mobile] Connected! Sending authentication...');
        
        // Step 1: Send authentication message IMMEDIATELY
        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString());
        console.log('📨 [Mobile] Received:', message);

        // Step 2: Handle authentication response
        if (message.type === 'success' && !this.authenticated) {
          console.log('🔐 [Mobile] Authentication successful!');
          this.authenticated = true;
          
          // Step 3: Register as video producer
          this.register();
        } 
        else if (message.type === 'success' && !this.registered) {
          console.log('✅ [Mobile] Registration successful!');
          this.registered = true;
          resolve();
        }
        else if (message.type === 'error') {
          console.error('❌ [Mobile] Error:', message.message);
          if (!this.authenticated) {
            reject(new Error(message.message));
          }
        }
        else if (message.type === 'alert') {
          // Received security alert from ML service
          console.log('🚨 [Mobile] ALERT:', message);
          this.handleAlert(message);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ [Mobile] WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('🔌 [Mobile] WebSocket closed');
        this.authenticated = false;
        this.registered = false;
      };
    });
  }

  /**
   * Step 1: Send authentication message
   */
  private authenticate(): void {
    if (!this.ws) return;

    const authMessage = {
      type: 'auth',
      token: this.token,
    };

    console.log('🔑 [Mobile] Authenticating...');
    this.ws.send(JSON.stringify(authMessage));
  }

  /**
   * Step 2: Register as video producer
   */
  private register(): void {
    if (!this.ws || !this.authenticated) return;

    const registerMessage = {
      type: 'register',
      streamId: this.streamId,
      clientType: 'mobile',
      produces: ['video-frame'],
      consumes: ['alert'],
    };

    console.log('📝 [Mobile] Registering as video producer...');
    this.ws.send(JSON.stringify(registerMessage));
  }

  /**
   * Send video frame (only after authenticated and registered)
   */
  sendVideoFrame(frameData: string): void {
    if (!this.ws || !this.authenticated || !this.registered) {
      console.error('❌ [Mobile] Cannot send frame - not ready');
      return;
    }

    const message = {
      type: 'video-frame',
      streamId: this.streamId,
      data: frameData,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    console.log('📹 [Mobile] Sent video frame');
  }

  /**
   * Handle security alerts from ML service
   */
  private handleAlert(alert: any): void {
    console.log(`🚨 [Mobile] Security Alert: ${alert.severity} - ${alert.message}`);
    // In real app: show notification, update UI, etc.
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.ws?.close();
  }
}

// Example usage
async function main() {
  // In production, get token from your OAuth flow
  const token = process.env.SESSION_TOKEN || 'test_session_token_12345';
  const streamId = `mobile-stream-${Date.now()}`;

  const client = new MobileStreamClient(streamId, token);

  try {
    // Connect and authenticate
    await client.connect();
    console.log('🎉 [Mobile] Ready to stream!');

    // Simulate sending video frames
    let frameCount = 0;
    const interval = setInterval(() => {
      const fakeFrame = Buffer.from(`fake_video_frame_${frameCount}`).toString('base64');
      client.sendVideoFrame(fakeFrame);
      frameCount++;

      if (frameCount >= 5) {
        clearInterval(interval);
        console.log('✅ [Mobile] Sent 5 frames, disconnecting...');
        client.disconnect();
      }
    }, 1000);

  } catch (error) {
    console.error('❌ [Mobile] Failed to connect:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.main) {
  main();
}

export { MobileStreamClient };
