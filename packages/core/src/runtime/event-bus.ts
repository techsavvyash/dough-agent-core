/**
 * Sequential event dispatcher for platform events.
 *
 * Handlers for a given event type run sequentially in registration order.
 * This is critical for events like `tool:call` where one extension's veto()
 * must take effect before the next handler runs.
 *
 * Handler errors are isolated — a failing handler does not prevent subsequent
 * handlers from running.
 */

import type {
  PlatformEventType,
  PlatformEventOfType,
} from "./events.ts";

export type PlatformEventHandler<T extends PlatformEventType> = (
  event: PlatformEventOfType<T>,
) => void | Promise<void>;

export type ErrorHandler = (
  eventType: PlatformEventType,
  error: unknown,
  handlerIndex: number,
) => void;

export class EventBus {
  private handlers = new Map<
    PlatformEventType,
    Array<PlatformEventHandler<any>>
  >();

  private errorHandler: ErrorHandler = (eventType, error, idx) => {
    console.error(
      `[EventBus] Handler ${idx} for "${eventType}" threw:`,
      error,
    );
  };

  /**
   * Set a custom error handler for when event handlers throw.
   * By default, errors are logged to console.error.
   */
  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  /**
   * Subscribe to a platform event type.
   * Returns an unsubscribe function.
   */
  on<T extends PlatformEventType>(
    type: T,
    handler: PlatformEventHandler<T>,
  ): () => void {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(handler);

    return () => this.off(type, handler);
  }

  /**
   * Remove a previously registered handler.
   */
  off<T extends PlatformEventType>(
    type: T,
    handler: PlatformEventHandler<T>,
  ): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Emit an event, running all handlers sequentially.
   * Errors in individual handlers are caught and reported via the
   * error handler, but do not stop subsequent handlers.
   */
  async emit<T extends PlatformEventType>(
    event: PlatformEventOfType<T>,
  ): Promise<void> {
    const list = this.handlers.get(event.type);
    if (!list || list.length === 0) return;

    // Snapshot the handler list to avoid mutation during iteration
    const snapshot = [...list];
    for (let i = 0; i < snapshot.length; i++) {
      try {
        const handler = snapshot[i];
        if (handler) await handler(event);
      } catch (err) {
        this.errorHandler(event.type, err, i);
      }
    }
  }

  /**
   * Check if any handlers are registered for a given event type.
   */
  hasHandlers(type: PlatformEventType): boolean {
    const list = this.handlers.get(type);
    return !!list && list.length > 0;
  }

  /**
   * Remove all handlers. Used during dispose.
   */
  clear(): void {
    this.handlers.clear();
  }
}
