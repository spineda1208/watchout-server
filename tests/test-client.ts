/**
 * Test WebSocket Client with Better Auth Integration
 * 
 * This script demonstrates how to connect to the WebSocket server with authentication
 * and test different client types:
 * - Mobile producer (sends video frames)
 * - Dashboard consumer (receives video frames and alerts)
 * - ML service (receives video frames, sends alerts)
 * 
 * IMPORTANT: You need a valid Better Auth session token to connect.
 * 
 * Set the SESSION_TOKEN environment variable:
 * export SESSION_TOKEN="your-session-token-here"
 * 
 * Or modify the TEST_TOKEN constant below.
 */

// Get session token from environment or use a test token
const SESSION_TOKEN = process.env.SESSION_TOKEN || "";

if (!SESSION_TOKEN) {
  console.error("❌ ERROR: No session token provided!");
  console.error("Please set SESSION_TOKEN environment variable:");
  console.error("  export SESSION_TOKEN=\"your-token-here\"");
  console.error("  bun tests/test-client.ts");
  console.error("\nTo get a session token:");
  console.error("  1. Log in to your Next.js app");
  console.error("  2. Check cookies for 'better-auth.session_token'");
  console.error("  3. Or use your auth API to get the token");
  process.exit(1);
}

// Test Mobile Client (Producer)
async function testMobileClient(streamId: string) {
  console.log("\n🤳 Testing Mobile Client (Video Producer)...");
  
  const ws = new WebSocket(`ws://localhost:3000/ws?token=${SESSION_TOKEN}`);

  ws.onopen = () => {
    console.log("✅ Mobile client connected");

    // Register as mobile producer (no need to send userId - it's from auth)
    ws.send(JSON.stringify({
      type: "register",
      clientType: "mobile",
      streamId: streamId,
      produces: ["video-frame"],
      consumes: ["alert"],
    }));

    // Simulate sending video frames
    let frameCount = 0;
    const interval = setInterval(() => {
      if (frameCount >= 5) {
        clearInterval(interval);
        console.log("📹 Sent 5 video frames");
        return;
      }

      ws.send(JSON.stringify({
        type: "video-frame",
        streamId: streamId,
        data: `fake_base64_frame_data_${frameCount}`,
        timestamp: Date.now(),
      }));

      console.log(`📤 Sent video frame ${frameCount + 1}`);
      frameCount++;
    }, 1000);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log(`📨 Mobile received:`, message);
  };

  ws.onerror = (error) => {
    console.error("❌ Mobile client error:", error);
  };

  ws.onclose = () => {
    console.log("🔌 Mobile client disconnected");
  };

  return ws;
}

// Test Dashboard Client (Consumer)
async function testDashboardClient(streamId: string) {
  console.log("\n🖥️  Testing Dashboard Client (Video & Alert Consumer)...");
  
  const ws = new WebSocket(`ws://localhost:3000/ws?token=${SESSION_TOKEN}`);

  ws.onopen = () => {
    console.log("✅ Dashboard client connected");

    // Subscribe to video frames and alerts (no need to send userId - it's from auth)
    ws.send(JSON.stringify({
      type: "subscribe",
      clientType: "dashboard",
      streamId: streamId,
      consumes: ["video-frame", "alert"],
    }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === "video-frame") {
      console.log(`📺 Dashboard received video frame from stream ${message.streamId}`);
    } else if (message.type === "alert") {
      console.log(`🚨 Dashboard received alert: [${message.severity}] ${message.message}`);
    } else {
      console.log(`📨 Dashboard received:`, message);
    }
  };

  ws.onerror = (error) => {
    console.error("❌ Dashboard client error:", error);
  };

  ws.onclose = () => {
    console.log("🔌 Dashboard client disconnected");
  };

  return ws;
}

// Test ML Service Client (Consumer & Producer)
async function testMLServiceClient(streamId: string) {
  console.log("\n🤖 Testing ML Service Client (Video Consumer & Alert Producer)...");
  
  const ws = new WebSocket(`ws://localhost:3000/ws?token=${SESSION_TOKEN}`);

  ws.onopen = () => {
    console.log("✅ ML Service client connected");

    // Subscribe to video frames and produce alerts
    ws.send(JSON.stringify({
      type: "subscribe",
      clientType: "ml-service",
      streamId: streamId,
      consumes: ["video-frame"],
      produces: ["alert"],
    }));
  };

  let frameCount = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === "video-frame") {
      frameCount++;
      console.log(`🎥 ML Service analyzing frame ${frameCount}...`);

      // Simulate detecting something suspicious on 3rd frame
      if (frameCount === 3) {
        console.log(`⚠️  ML Service detected suspicious activity!`);
        ws.send(JSON.stringify({
          type: "alert",
          streamId: streamId,
          severity: "high",
          message: "Suspicious person detected in frame",
          metadata: {
            confidence: 0.95,
            location: { x: 120, y: 350 },
            objectType: "person",
          },
          timestamp: Date.now(),
        }));
      }
    } else {
      console.log(`📨 ML Service received:`, message);
    }
  };

  ws.onerror = (error) => {
    console.error("❌ ML Service client error:", error);
  };

  ws.onclose = () => {
    console.log("🔌 ML Service client disconnected");
  };

  return ws;
}

// Run tests
async function runTests() {
  console.log("🧪 Starting WebSocket Tests");
  console.log("===========================");

  const streamId = `test-stream-${Date.now()}`;
  console.log(`📹 Using stream ID: ${streamId}`);

  // Connect all clients
  const dashboardWs = await testDashboardClient(streamId);
  await new Promise(resolve => setTimeout(resolve, 500));

  const mlServiceWs = await testMLServiceClient(streamId);
  await new Promise(resolve => setTimeout(resolve, 500));

  const mobileWs = await testMobileClient(streamId);

  // Keep alive for 10 seconds then close
  setTimeout(() => {
    console.log("\n✅ Tests complete! Closing connections...");
    mobileWs.close();
    dashboardWs.close();
    mlServiceWs.close();
    
    setTimeout(() => {
      console.log("\n🏁 All tests finished!");
      process.exit(0);
    }, 1000);
  }, 10000);
}

// Run the tests
runTests().catch(console.error);
