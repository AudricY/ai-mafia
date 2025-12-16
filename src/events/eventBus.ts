export type Unsubscribe = () => void;

/**
 * Minimal synchronous event bus.
 *
 * - Never throws to callers (subscriber errors are swallowed)
 * - Preserves emission order for each subscriber
 */
export class EventBus<TEvent> {
  private subscribers: Set<(event: TEvent) => void> = new Set();

  subscribe(cb: (event: TEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  emit(event: TEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // Never let subscribers crash the engine.
      }
    }
  }
}


