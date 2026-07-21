/**
 * EventBus.js — tiny synchronous pub/sub.
 *
 * Systems never reach into each other. Player emits EVENT.PLAYER_JUMP; the audio
 * engine, particle system and camera all listen. Add a new reaction to a jump by
 * subscribing — you never touch Player again. This is the seam that keeps the
 * render / audio / gameplay layers independently swappable and testable.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._channels = new Map();
  }

  on(type, handler) {
    let set = this._channels.get(type);
    if (!set) this._channels.set(type, (set = new Set()));
    set.add(handler);
    return () => this.off(type, handler); // returns an unsubscribe thunk
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    this._channels.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const set = this._channels.get(type);
    if (!set) return;
    // Snapshot so a handler that unsubscribes mid-dispatch can't corrupt iteration.
    for (const handler of [...set]) handler(payload);
  }

  clear(type) {
    if (type) this._channels.delete(type);
    else this._channels.clear();
  }
}
