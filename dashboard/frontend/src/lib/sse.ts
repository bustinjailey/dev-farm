type EventHandler = (data: any) => void;

interface Handlers {
  [event: string]: Set<EventHandler>;
}

export class SSEClient {
  private source: EventSource | null = null;
  private handlers: Handlers = {};
  private registeredEvents: Set<string> = new Set();
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

    // Default 'message' event handler (fallback for events without explicit type)
    this.source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.emit('message', payload);
      } catch (error) {
        console.error('Failed to parse default SSE message', error);
      }
    };

    // Re-register all event listeners that were added before connection
    this.registeredEvents.forEach(eventType => {
      this.registerEventListener(eventType);
    });
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
      // Automatically register EventSource listener for this event type
      this.registeredEvents.add(event);
      if (this.source && event !== 'message') {
        this.registerEventListener(event);
      }
    }
    this.handlers[event].add(handler);
  }

  private registerEventListener(eventType: string) {
    if (!this.source || eventType === 'message') return;
    
    this.source.addEventListener(eventType, (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data);
        this.emit(eventType, payload);
      } catch (error) {
        console.error(`Failed to parse SSE payload for event '${eventType}'`, error);
      }
    });
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
