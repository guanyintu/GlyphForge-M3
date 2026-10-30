/** Presentation-only state. Never persisted on Candidate or used to order results. */
export interface Bounds { width: number; height: number }
export interface Body { key: string; x: number; y: number; vx: number; vy: number; width: number; height: number; phase: number; targetX: number; targetY: number; steer: number }
export type Quality = "full" | "low" | "static";
export const MAX_BODIES = 48;
export const MAX_DURATION = 18;
export function fieldLayout(bounds: Bounds, quality: Quality) {
  const columns = Math.max(1, Math.floor(bounds.width / 156));
  const rows = Math.max(1, Math.floor(bounds.height / 54));
  return { columns, rows, width: Math.max(1, Math.min(144, bounds.width - 4)), height: Math.max(1, Math.min(42, bounds.height - 4)), limit: Math.min(quality === "full" ? MAX_BODIES : quality === "low" ? 20 : 12, columns * rows) };
}
export function constrain(body: Body, bounds: Bounds) {
  const right = Math.max(0, bounds.width - body.width), bottom = Math.max(0, bounds.height - body.height);
  if (body.x < 0 || body.x > right) { body.x = Math.max(0, Math.min(right, body.x)); body.vx = body.x === 0 ? Math.abs(body.vx) * .75 : -Math.abs(body.vx) * .75; }
  if (body.y < 0 || body.y > bottom) { body.y = Math.max(0, Math.min(bottom, body.y)); body.vy = body.y === 0 ? Math.abs(body.vy) * .75 : -Math.abs(body.vy) * .75; }
}
export function reconcileBodies(previous: Body[], keys: string[], bounds: Bounds, quality: Quality, random = Math.random, reflow = false): Body[] {
  const layout = fieldLayout(bounds, quality), old = new Map(previous.map(b => [b.key, b]));
  return keys.slice(0, layout.limit).map((key, i) => {
    const targetX = (i % layout.columns + .5) * bounds.width / layout.columns - layout.width / 2;
    const targetY = (Math.floor(i / layout.columns) + .5) * bounds.height / layout.rows - layout.height / 2;
    const existing = old.get(key);
    const body: Body = existing ? { ...existing, ...(reflow ? { x: targetX, y: targetY } : {}), width: layout.width, height: layout.height, targetX, targetY, steer: reflow ? 0 : 1.2 } : {
      key, x: targetX + (random() - .5) * Math.max(0, bounds.width / layout.columns - layout.width - 6) * .5,
      y: targetY + (random() - .5) * Math.max(0, bounds.height / layout.rows - layout.height - 6) * .5,
      width: layout.width, height: layout.height, targetX, targetY, steer: 0,
      vx: (targetX + layout.width / 2 < bounds.width / 2 ? -1 : 1) * (16 + random() * 20),
      vy: (random() - .5) * 38, phase: random() * Math.PI * 2,
    };
    constrain(body, bounds); return body;
  });
}
export function stepBodies(bodies: Body[], bounds: Bounds, elapsed: number, delta: number) {
  const dt = Math.max(0, Math.min(.032, delta));
  for (const b of bodies) {
    if (b.steer > 0) {
      b.vx += (b.targetX - b.x) * 5 * dt; b.vy += (b.targetY - b.y) * 5 * dt; b.steer -= dt;
    }
    b.vx = Math.max(-55, Math.min(55, (b.vx + Math.sin(elapsed + b.phase) * 3 * dt) * Math.exp(-.3 * dt)));
    b.vy = Math.max(-40, Math.min(40, (b.vy + Math.cos(elapsed * .8 + b.phase) * 3 * dt) * Math.exp(-.3 * dt)));
    b.x += b.vx * dt; b.y += b.vy * dt;
    constrain(b, bounds);
  }
  // Bounded O(48²), three relaxation passes, impulses only for closing pairs.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
      const ox = (a.width + b.width) / 2 + 3 - Math.abs(dx), oy = (a.height + b.height) / 2 + 3 - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      const horizontal = ox < oy, sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
      const correction = ((horizontal ? ox : oy) + .01) / 2;
      if (horizontal) { a.x -= sign * correction; b.x += sign * correction; }
      else { a.y -= sign * correction; b.y += sign * correction; }
      const relative = ((horizontal ? b.vx - a.vx : b.vy - a.vy)) * sign;
      if (relative < 0) {
        const impulse = -relative * .65;
        if (horizontal) { a.vx -= impulse * sign; b.vx += impulse * sign; }
        else { a.vy -= impulse * sign; b.vy += impulse * sign; }
      }
      constrain(a, bounds); constrain(b, bounds);
    }
  }
}

/** Slow frames must persist for a window; a single layout spike is not a verdict. */
export class FrameBudget {
  private samples: number[] = [];
  quality: Quality;
  constructor(lowDevice = false) { this.quality = lowDevice ? "low" : "full"; }
  sample(interval: number): Quality {
    this.samples.push(interval);
    if (this.samples.length < 45) return this.quality;
    const mean = this.samples.reduce((sum, n) => sum + n, 0) / this.samples.length;
    this.samples = [];
    if (mean > 30) this.quality = this.quality === "full" ? "low" : "static";
    return this.quality;
  }
  resetWindow() { this.samples = []; }
}
