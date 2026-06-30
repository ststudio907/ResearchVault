// src/utils/event-emitter.ts
//
// Tiny typed event emitter. Prefers a hand-rolled implementation rather than
// Node's `events` module because the latter is not available on Obsidian
// Mobile. The contract mirrors the slice of the Node API we actually use:
// `on(listener)` returns an unsubscribe, `emit(payload)` is synchronous, and
// a misbehaving listener cannot break the chain for its peers.
//

export type EventListener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class EventEmitter<T> {
  private listeners = new Set<EventListener<T>>();

  /**
   * Register a listener. Returns an `Unsubscribe` function so callers can
   * use `plugin.register(() => unsub())` for idempotent cleanup on unload.
   */
  on(listener: EventListener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Synchronously fan-out to all subscribers. Listener exceptions are caught and logged so one bad listener cannot poison the chain. */
  emit(payload: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(payload);
      } catch (err) {
         
        console.error('[ResearchVault] EventEmitter listener threw:', err);
      }
    }
  }

  /** Drop every registered listener. Used during plugin unload cleanup. */
  clear(): void {
    this.listeners.clear();
  }

  /** Number of registered listeners — useful for diagnostics and tests. */
  listenerCount(): number {
    return this.listeners.size;
  }
}
