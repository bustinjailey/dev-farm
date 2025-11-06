type EventHandler = (data: any) => void;

interface Handlers {
  [event: string]: Set<EventHandler>;
}

export class SSEClient {
  private source: EventSource | null = null;
  private handlers: Handlers = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string) { }

  connect() {
    if (this.source) return;
    this.source = new EventSource(this.url);
    this.source.onopen = () => {
      /* connected */
    };
    this.source.onerror = () => {
      this.teardownSource();
      this.scheduleReconnect();
    };

    this.source.onmessage = (event) => {
      this.emit('message', JSON.parse(event.data));
    };

    const known = ['registry-update', 'env-status', 'update-progress', 'update-started', 'ai-response', 'device-auth'];
    for (const event of known) {
      this.source.addEventListener(event, (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data);
          this.emit(event, payload);
        } catch (error) {
          console.error('Failed to parse SSE payload', error);
        }
      });
    }
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
    }
    this.handlers[event].add(handler);
  }

  off(event: string, handler: EventHandler) {
    this.handlers[event]?.delete(handler);
  }

  private emit(event: string, data: any) {
    this.handlers[event]?.forEach((handler) => handler(data));
  }

  disconnect() {
    this.teardownSource();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private teardownSource() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }
}

export const sseClient = new SSEClient('/api/stream');
