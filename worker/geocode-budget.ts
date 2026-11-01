// An in-isolate mitigation layered under the edge cache, not an account-wide
// guarantee. Allow a burst of 20 calls, refill 20/minute, and run at most 2.
// Only resolved text is shared; callers never share a Response body stream.
export class GeocodeBudget {
  private tokens = 20;
  private updated: number;
  private pending = new Map<string, Promise<string>>();

  constructor(private now: () => number = Date.now) {
    this.updated = now();
  }

  run(key: string, load: () => Promise<string>): Promise<string> | null {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const time = this.now();
    this.tokens = Math.min(20, this.tokens + Math.max(0, time - this.updated) / 3000);
    this.updated = time;
    if (this.tokens < 1 || this.pending.size >= 2) return null;
    this.tokens--;
    const task = Promise.resolve().then(load).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
