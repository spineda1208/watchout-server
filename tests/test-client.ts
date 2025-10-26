/**
 * Test WebSocket Client
 * 
 * This script demonstrates how to connect to the WebSocket server and test different client types:
 * - Mobile producer (sends video frames)
 * - Dashboard consumer (receives video frames and alerts)
 * - ML service (receives video frames, sends alerts)
 */

// Test Mobile Client (Producer)
async function testMobileClient(streamId: string) {
  console.log("\n🤳 Testing Mobile Client (Video Producer)...");
  
  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.onopen = () => {
    console.log("✅ Mobile client connected");

    // Register as mobile producer
    ws.send(JSON.stringify({
      type: "register",
      clientType: "mobile",
      streamId: streamId,
      produces: ["video-frame"],
      consumes: ["alert"],
      userId: "user123",
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
  
  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.onopen = () => {
    console.log("✅ Dashboard client connected");

    // Subscribe to video frames and alerts
    ws.send(JSON.stringify({
      type: "subscribe",
      clientType: "dashboard",
      streamId: streamId,
      consumes: ["video-frame", "alert"],
      userId: "user123",
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
  
  const ws = new WebSocket("ws://localhost:3000/ws");

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
