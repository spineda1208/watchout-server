/**
 * Metrics tracking for monitoring performance
 */

interface StreamMetrics {
  streamId: string;
  frameCount: number;
  lastFrameTime: number;
  startTime: number;
  fps: number;
  lastFpsUpdate: number;
}

class MetricsTracker {
  private streams: Map<string, StreamMetrics> = new Map();
  private fpsUpdateInterval = 1000; // Update FPS every second

  /**
   * Track a video frame
   */
  trackFrame(streamId: string): void {
    const now = Date.now();
    let metrics = this.streams.get(streamId);

    if (!metrics) {
      metrics = {
        streamId,
        frameCount: 0,
        lastFrameTime: now,
        startTime: now,
        fps: 0,
        lastFpsUpdate: now,
      };
      this.streams.set(streamId, metrics);
    }

    metrics.frameCount++;
    const timeSinceLastUpdate = now - metrics.lastFpsUpdate;

    // Calculate FPS every second
    if (timeSinceLastUpdate >= this.fpsUpdateInterval) {
      const framesSinceLastUpdate = metrics.frameCount;
      const timeDelta = (now - metrics.lastFpsUpdate) / 1000; // Convert to seconds
      metrics.fps = Math.round(framesSinceLastUpdate / timeDelta);
      metrics.lastFpsUpdate = now;
      metrics.frameCount = 0; // Reset counter
    }

    metrics.lastFrameTime = now;
  }

  /**
   * Get current FPS for a stream
   */
  getFPS(streamId: string): number {
    return this.streams.get(streamId)?.fps || 0;
  }

  /**
   * Get all metrics for a stream
   */
  getStreamMetrics(streamId: string): StreamMetrics | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Get all stream metrics
   */
  getAllMetrics(): Map<string, StreamMetrics> {
    return this.streams;
  }

  /**
   * Remove metrics for a stream
   */
  removeStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.streams.clear();
  }
}

export const metricsTracker = new MetricsTracker();
