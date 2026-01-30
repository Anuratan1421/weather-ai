// lib/stream-manager.js
// Resumable stream manager inspired by scira's implementation
import { EventEmitter } from "events";

export class StreamManager extends EventEmitter {
  constructor(redisClient) {
    super();
    this.redisClient = redisClient;
    this.activeStreams = new Map(); // streamId -> { messageId, text, status }
    this.setMaxListeners(100);
  }

  /**
   * Create a new stream session
   */
  async createStream(conversationId, messageId) {
    const streamId = `stream:${conversationId}:${messageId}`;
    
    this.activeStreams.set(streamId, {
      messageId,
      conversationId,
      text: "",
      status: "active",
      startedAt: Date.now()
    });

    // Store in Redis with TTL
    await this.redisClient.setEx(
      `${streamId}:meta`,
      7200, // 2 hours
      JSON.stringify({
        messageId,
        conversationId,
        startedAt: Date.now()
      })
    );

    return streamId;
  }

  /**
   * Append text to a stream
   */
  async appendToStream(streamId, chunk) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    stream.text += chunk;
    
    // Store incremental text in Redis for resumability
    await this.redisClient.xAdd(streamId, '*', {
      type: 'token',
      content: chunk,
      timestamp: Date.now().toString()
    });

    // Set expiry on stream
    await this.redisClient.expire(streamId, 7200);

    return stream.text;
  }

  /**
   * Complete a stream
   */
  async completeStream(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      return null;
    }

    stream.status = "completed";
    
    // Mark completion in Redis
    await this.redisClient.xAdd(streamId, '*', {
      type: 'complete',
      timestamp: Date.now().toString()
    });

    const result = { ...stream };
    this.activeStreams.delete(streamId);
    
    return result;
  }

  /**
   * Resume a stream - get all accumulated text
   */
  async resumeStream(streamId) {
    // Check active streams first
    const activeStream = this.activeStreams.get(streamId);
    if (activeStream) {
      return {
        found: true,
        text: activeStream.text,
        status: activeStream.status,
        messageId: activeStream.messageId
      };
    }

    // Check Redis for recent streams
    try {
      const events = await this.redisClient.xRange(streamId, '-', '+');
      
      if (events.length === 0) {
        return { found: false };
      }

      let accumulatedText = "";
      let status = "active";

      for (const event of events) {
        const data = event.message;
        if (data.type === 'token') {
          accumulatedText += data.content;
        } else if (data.type === 'complete') {
          status = "completed";
        }
      }

      return {
        found: true,
        text: accumulatedText,
        status,
        fromRedis: true
      };
    } catch (err) {
      console.error('Resume stream error:', err);
      return { found: false };
    }
  }

  /**
   * Clean up old streams
   */
  async cleanup() {
    const now = Date.now();
    const timeout = 2 * 60 * 60 * 1000; // 2 hours

    for (const [streamId, stream] of this.activeStreams.entries()) {
      if (now - stream.startedAt > timeout) {
        this.activeStreams.delete(streamId);
      }
    }
  }
}
