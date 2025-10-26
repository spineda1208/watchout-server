/**
 * Dashboard Client Example - Video/Alert Consumer
 * 
 * This demonstrates how to connect a web dashboard to view video streams
 * and receive security alerts with secure authentication.
 */

class DashboardClient {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private subscribed = false;
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
      console.log('🖥️  [Dashboard] Connecting to WebSocket...');
      
      // IMPORTANT: Connect WITHOUT token in URL (secure!)
      this.ws = new WebSocket('ws://localhost:3000/streams/subscribe');

      this.ws.onopen = () => {
        console.log('✅ [Dashboard] Connected! Sending authentication...');
        
        // Step 1: Send authentication message IMMEDIATELY
        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString());
        console.log('📨 [Dashboard] Received:', message);

        // Step 2: Handle authentication response
        if (message.type === 'success' && !this.authenticated) {
          console.log('🔐 [Dashboard] Authentication successful!');
          this.authenticated = true;
          
          // Step 3: Subscribe to stream
          this.subscribe();
        } 
        else if (message.type === 'success' && !this.subscribed) {
          console.log('✅ [Dashboard] Subscription successful!');
          this.subscribed = true;
          resolve();
        }
        else if (message.type === 'error') {
          console.error('❌ [Dashboard] Error:', message.message);
          if (!this.authenticated) {
            reject(new Error(message.message));
          }
        }
        else if (message.type === 'video-frame') {
          // Received video frame from mobile
          this.handleVideoFrame(message);
        }
        else if (message.type === 'alert') {
          // Received security alert from ML service
          this.handleAlert(message);
        }
        else if (message.type === 'status') {
          // Stream status update
          this.handleStatus(message);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ [Dashboard] WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('🔌 [Dashboard] WebSocket closed');
        this.authenticated = false;
        this.subscribed = false;
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

    console.log('🔑 [Dashboard] Authenticating...');
    this.ws.send(JSON.stringify(authMessage));
  }

  /**
   * Step 2: Subscribe to stream
   */
  private subscribe(): void {
    if (!this.ws || !this.authenticated) return;

    const subscribeMessage = {
      type: 'subscribe',
      streamId: this.streamId,
      clientType: 'dashboard',
      consumes: ['video-frame', 'alert'],
    };

    console.log('📝 [Dashboard] Subscribing to stream...');
    this.ws.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Handle incoming video frame
   */
  private handleVideoFrame(frame: any): void {
    console.log(`📹 [Dashboard] Video frame received (timestamp: ${frame.timestamp})`);
    // In real app: decode base64, display in video element, etc.
    // Example: imgElement.src = `data:image/jpeg;base64,${frame.data}`;
  }

  /**
   * Handle security alert
   */
  private handleAlert(alert: any): void {
    console.log(`🚨 [Dashboard] Security Alert: ${alert.severity} - ${alert.message}`);
    if (alert.metadata) {
      console.log(`   Confidence: ${alert.metadata.confidence}`);
      console.log(`   Object: ${alert.metadata.objectType}`);
    }
    // In real app: show notification, highlight area, etc.
  }

  /**
   * Handle stream status update
   */
  private handleStatus(status: any): void {
    console.log(`📊 [Dashboard] Stream status: ${status.status}`);
    // In real app: update UI to show stream is online/offline/streaming
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
  // Get stream ID from command line or use default
  const args = process.argv.slice(2);
  const streamId = args[0] || 'mobile-stream-12345';
  const token = process.env.SESSION_TOKEN || 'test_session_token_12345';

  console.log(`🎯 [Dashboard] Subscribing to stream: ${streamId}`);

  const client = new DashboardClient(streamId, token);

  try {
    // Connect and authenticate
    await client.connect();
    console.log('🎉 [Dashboard] Connected and subscribed! Waiting for video frames and alerts...');

    // Keep connection alive (in real app, this runs until user closes)
    // Press Ctrl+C to exit

  } catch (error) {
    console.error('❌ [Dashboard] Failed to connect:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.main) {
  main();
}

export { DashboardClient };
