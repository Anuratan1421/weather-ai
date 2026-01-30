// lib/sse-handler.js
// SSE connection handler with reconnection support

export class SSEConnectionManager {
  constructor() {
    this.connections = new Map(); // conversationId -> Set<response>
  }

  /**
   * Add a new SSE connection
   */
  addConnection(conversationId, res) {
    if (!this.connections.has(conversationId)) {
      this.connections.set(conversationId, new Set());
    }
    this.connections.get(conversationId).add(res);
    
    console.log(`📡 SSE: ${conversationId} | Total clients: ${this.connections.get(conversationId).size}`);
  }

  /**
   * Remove a connection
   */
  removeConnection(conversationId, res) {
    const clients = this.connections.get(conversationId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.connections.delete(conversationId);
      }
    }
  }

  /**
   * Broadcast to all clients in a conversation
   */
  broadcast(conversationId, eventType, data, eventId = null) {
    const clients = this.connections.get(conversationId);
    if (!clients) return;

    const payload = JSON.stringify(data);
    const deadClients = [];

    for (const client of clients) {
      try {
        if (eventId) {
          client.write(`id: ${eventId}\n`);
        }
        // Don't use custom event type - use default for compatibility
        client.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.error(`Failed to send to client:`, err.message);
        deadClients.push(client);
      }
    }

    // Remove dead connections
    for (const client of deadClients) {
      this.removeConnection(conversationId, client);
    }
  }

  /**
   * Send to a specific client
   */
  sendToClient(res, eventType, data, eventId = null) {
    try {
      if (eventId) {
        res.write(`id: ${eventId}\n`);
      }
      // Don't use custom event type - use default for compatibility
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (err) {
      console.error('Failed to write to client:', err.message);
      return false;
    }
  }

  /**
   * Setup SSE headers and heartbeat
   */
  setupSSE(res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    return heartbeat;
  }

  /**
   * Get client count for a conversation
   */
  getClientCount(conversationId) {
    return this.connections.get(conversationId)?.size || 0;
  }
}
