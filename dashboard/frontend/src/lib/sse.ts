type EventHandler = (data: any) => void;

interface Handlers {
  [event: string]: Set<EventHandler>;
}

export class SSEClient {
  private source: EventSource | null = null;
  private handlers: Handlers = {};
  private registeredEvents: Set<string> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private eventListeners: Map<string, (event: MessageEvent) => void> = new Map();
  private readonly defaultMessageHandler = (event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data);
      this.emit('message', payload);
    } catch (error) {
      console.error('Failed to parse default SSE message', error);
    }
  };

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
    this.source.onmessage = this.defaultMessageHandler;

    // Re-register all event listeners that were added before connection
    this.registeredEvents.forEach((eventType) => {
      this.registerEventListener(eventType);
    });
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
      // Automatically register EventSource listener for this event type
      this.registeredEvents.add(event);
      if (this.source) {
        if (event === 'message') {
          this.source.onmessage = this.defaultMessageHandler;
        } else {
          this.registerEventListener(event);
        }
      }
    }
    this.handlers[event].add(handler);
  }

  private registerEventListener(eventType: string) {
    if (!this.source || eventType === 'message') return;

    if (this.eventListeners.has(eventType)) {
      return;
    }

    const listener = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        this.emit(eventType, payload);
      } catch (error) {
        console.error(`Failed to parse SSE payload for event '${eventType}'`, error);
      }
    };

    this.eventListeners.set(eventType, listener);
    this.source.addEventListener(eventType, listener);
  }

  private removeEventListener(eventType: string) {
    if (!this.source || eventType === 'message') return;

    const listener = this.eventListeners.get(eventType);
    if (listener) {
      this.source.removeEventListener(eventType, listener);
      this.eventListeners.delete(eventType);
    }
  }

  off(event: string, handler: EventHandler) {
    const handlers = this.handlers[event];
    handlers?.delete(handler);

    if (!handlers || handlers.size === 0) {
      if (event === 'message' && this.source) {
        this.source.onmessage = null;
      } else {
        this.removeEventListener(event);
      }
      delete this.handlers[event];
      this.registeredEvents.delete(event);
    }
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
    this.eventListeners.clear();
  }
}

export const sseClient = new SSEClient('/api/stream');
