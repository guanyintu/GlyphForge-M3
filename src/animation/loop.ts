import { MAX_DURATION } from "./physics";

export interface Scheduler { request: (callback: (time: number) => void) => number; cancel: (id: number) => void }
/** One owned RAF. Pause preserves elapsed active time; dispose is idempotent. */
export class MotionLoop {
  private frame: number | undefined;
  private previous: number | undefined;
  private disposed = false;
  private running = false;
  elapsed = 0;
  constructor(private scheduler: Scheduler, private update: (delta: number, elapsed: number, interval: number) => void, private expired: () => void) {}
  start() {
    if (this.disposed || this.frame !== undefined || this.elapsed >= MAX_DURATION) return;
    this.running = true;
    this.previous = undefined;
    const tick = (time: number) => {
      this.frame = undefined;
      if (this.disposed || !this.running) return;
      const interval = this.previous === undefined ? 0 : time - this.previous;
      this.previous = time;
      const delta = Math.min(.05, Math.max(0, interval / 1000));
      // Stop by active wall time even when a slow frame needs a clamped physics step.
      this.elapsed += Math.max(0, interval / 1000);
      this.update(delta, this.elapsed, interval);
      if (this.disposed || !this.running) return;
      if (this.elapsed >= MAX_DURATION) { this.expired(); return; }
      this.frame = this.scheduler.request(tick);
    };
    this.frame = this.scheduler.request(tick);
  }
  pause() { this.running = false; if (this.frame !== undefined) this.scheduler.cancel(this.frame); this.frame = undefined; this.previous = undefined; }
  restart() { this.elapsed = 0; }
  dispose() { this.pause(); this.disposed = true; }
}
