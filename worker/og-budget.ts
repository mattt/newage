// An in-isolate mitigation layered under the edge cache, not an account-wide
// guarantee. Allow a burst of 6 renders, refill 6/minute, and run at most 2.
// Share completed PNG bytes, never Response body streams.
export class OgBudget {
  private tokens = 6;
  private updated: number;
  private pending = new Map<string, Promise<Uint8Array>>();

  constructor(private now: () => number = Date.now) {
    this.updated = now();
  }

  run(key: string, render: () => Promise<Uint8Array>): Promise<Uint8Array> | null {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const time = this.now();
    this.tokens = Math.min(6, this.tokens + Math.max(0, time - this.updated) / 10000);
    this.updated = time;
    if (this.tokens < 1 || this.pending.size >= 2) return null;
    this.tokens--;
    const task = Promise.resolve().then(render).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
