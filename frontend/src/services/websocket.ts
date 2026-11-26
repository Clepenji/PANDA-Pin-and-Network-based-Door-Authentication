/**
 * WebSocket service for receiving real-time lock updates and request events.
 */

type MessageHandler = (data: any) => void;

class WebSocketService {
  private sockets: Map<string, WebSocket> = new Map();
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private heartbeats: Map<string, ReturnType<typeof setInterval>> = new Map();
  private hasConnectedOnce: Set<string> = new Set();

  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);

    if (!this.sockets.has(channel) || this.sockets.get(channel)!.readyState >= WebSocket.CLOSING) {
      this.connect(channel);
    }

    // Return cleanup unsubscription function
    return () => {
      const set = this.handlers.get(channel);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          const hb = this.heartbeats.get(channel);
          if (hb) {
            clearInterval(hb);
            this.heartbeats.delete(channel);
          }
          const ws = this.sockets.get(channel);
          if (ws) {
            ws.close();
            this.sockets.delete(channel);
          }
          this.handlers.delete(channel);
        }
      }
    };
  }

  private connect(channel: string): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/v1/ws/${channel}`;

    const ws = new WebSocket(url);
    this.sockets.set(channel, ws);

    ws.onopen = () => {
      if (this.hasConnectedOnce.has(channel)) {
        window.dispatchEvent(new CustomEvent('panda:ws-reconnect', { detail: { channel } }));
      }
      this.hasConnectedOnce.add(channel);

      const existingHb = this.heartbeats.get(channel);
      if (existingHb) clearInterval(existingHb);
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 25000);
      this.heartbeats.set(channel, hb);
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const set = this.handlers.get(channel);
        if (set) {
          set.forEach((h) => h(parsed));
        }
      } catch (e) {
        // Ignore non-json frames (e.g. ping/pong)
      }
    };

    ws.onclose = () => {
      const hb = this.heartbeats.get(channel);
      if (hb) {
        clearInterval(hb);
        this.heartbeats.delete(channel);
      }
      // Reconnect after 3 seconds if subscribers still exist
      setTimeout(() => {
        if (this.handlers.has(channel) && this.handlers.get(channel)!.size > 0) {
          this.connect(channel);
        }
      }, 3000);
    };

    ws.onerror = (e) => {
      console.warn(`WebSocket error on channel ${channel}:`, e);
      ws.close();
    };
  }
}

export const wsService = new WebSocketService();
