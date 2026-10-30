import { describe, expect, it } from "vitest";
import { constrain, fieldLayout, FrameBudget, MAX_BODIES, reconcileBodies, stepBodies } from "../animation/physics";
import { MotionLoop } from "../animation/loop";
import type { Body } from "../animation/physics";
const bounds = { width: 1248, height: 432 };
const make = (key = "a", x = 20, vx = 10): Body => ({ key, x, y: 20, vx, vy: 0, width: 100, height: 42, phase: 0, targetX: x, targetY: 20, steer: 0 });
describe("P1-D bounded visual physics", () => {
  it("handles empty and one body without nonfinite coordinates", () => {
    stepBodies([], bounds, 0, .016);
    const b = reconcileBodies([], ["a"], bounds, "full", () => .5); stepBodies(b, bounds, 1, .016);
    expect(b).toHaveLength(1); expect(Number.isFinite(b[0].x)).toBe(true); expect(b[0].x).toBeGreaterThanOrEqual(0);
  });
  it("caps ten thousand inputs at 48, and low/static quality at 20/12", () => {
    const keys = Array.from({ length: 10000 }, (_, i) => String(i));
    for (const [quality, count] of [["full", MAX_BODIES], ["low", 20], ["static", 12]] as const)
      expect(reconcileBodies([], keys, bounds, quality)).toHaveLength(count);
    expect(keys[0]).toBe("0"); expect(keys).toHaveLength(10000);
  });
  it("limits density and handles tiny/zero containers", () => {
    expect(fieldLayout({ width: 320, height: 220 }, "full").limit).toBe(8);
    for (const size of [0, 1, 60]) {
      const box = { width: size, height: size }, b = reconcileBodies([], ["a"], box, "full")[0];
      stepBodies([b], box, 1, 100); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.width).toBeLessThanOrEqual(Math.max(1, size));
    }
  });
  it("rebounds on all four boundaries", () => {
    for (const [x, y, vx, vy] of [[-2, 0, -8, -8], [2000, 2000, 8, 8]]) {
      const b = { ...make("a", x, vx), y, vy }; constrain(b, bounds);
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(bounds.width);
      expect(b.y + b.height).toBeLessThanOrEqual(bounds.height);
      expect(Math.sign(b.vx)).toBe(x < 0 ? 1 : -1); expect(Math.sign(b.vy)).toBe(-1);
    }
    const top = { ...make(), y: -1, vy: -20 }; constrain(top, bounds); expect(top.vy).toBe(15);
  });
  it("separates overlapping rectangles and reverses approaching velocity", () => {
    const a = make("a", 20, 20), b = make("b", 115, -20);
    stepBodies([a, b], bounds, 0, 0);
    expect(b.x - a.x).toBeGreaterThanOrEqual(103); expect(a.vx).toBeLessThan(0); expect(b.vx).toBeGreaterThan(0);
  });
  it("does not repeatedly bounce separating pairs", () => {
    const a = make("a", 20, -10), b = make("b", 118, 10); stepBodies([a, b], bounds, 0, 0);
    expect(a.vx).toBe(-10); expect(b.vx).toBe(10);
  });
  it("resolves vertical overlaps", () => {
    const a = make(), b = { ...make("b"), y: 55 }; stepBodies([a, b], bounds, 0, 0); expect(b.y - a.y).toBeGreaterThanOrEqual(45);
  });
  it("preserves stable positions by key during reorder without mutating input", () => {
    const a = make(), before = JSON.stringify(a), next = reconcileBodies([a], ["b", "a"], bounds, "full");
    expect(next[1].x).toBe(a.x); expect(next[1].targetX).not.toBe(a.x); expect(next[1].steer).toBeGreaterThan(0); expect(JSON.stringify(a)).toBe(before);
  });
  it("constrains retained positions on resize", () => {
    const next = reconcileBodies([make("a", 1100)], ["a"], { width: 250, height: 100 }, "full");
    expect(next[0].x + next[0].width).toBeLessThanOrEqual(250);
  });
  it("reflows resized fields into free slots instead of stacking at a boundary", () => {
    const old = reconcileBodies([], Array.from({ length: 48 }, (_, i) => String(i)), bounds, "full");
    const box = { width: 350, height: 300 }, next = reconcileBodies(old, old.map(b => b.key), box, "full", () => .5, true);
    expect(next).toHaveLength(10); expect(new Set(next.map(b => `${b.x},${b.y}`)).size).toBe(10);
    expect(next.every(b => b.x === b.targetX && b.y === b.targetY)).toBe(true);
  });
  it("keeps a full field bounded over 18 seconds with no persistent overlap", () => {
    const bodies = reconcileBodies([], Array.from({ length: 48 }, (_, i) => String(i)), bounds, "full", () => .5);
    for (let i = 0; i < 1080; i++) stepBodies(bodies, bounds, i / 60, 1 / 60);
    for (const b of bodies) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(bounds.width); expect(b.y + b.height).toBeLessThanOrEqual(bounds.height); }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      expect(overlap).toBe(false);
    }
  });
  it("clamps large/negative delta and damps velocity", () => {
    const a = make(), b = make(); stepBodies([a], bounds, 0, 5); stepBodies([b], bounds, 0, .032); expect(a).toEqual(b);
    const c = make(); stepBodies([c], bounds, 0, -1); expect(c.x).toBe(20); expect(a.vx).toBeLessThan(10);
  });
  it("degrades only after a sustained slow window and never upgrades automatically", () => {
    const budget = new FrameBudget(); budget.sample(1000); for (let i = 0; i < 44; i++) budget.sample(16); expect(budget.quality).toBe("low");
    for (let i = 0; i < 45; i++) budget.sample(16); expect(budget.quality).toBe("low");
    for (let i = 0; i < 45; i++) budget.sample(45); expect(budget.quality).toBe("static");
    expect(new FrameBudget(true).quality).toBe("low");
  });
  it("ignores isolated short spikes and clears hidden-page sample windows", () => {
    const b = new FrameBudget(); b.sample(100); for (let i = 0; i < 44; i++) b.sample(16); expect(b.quality).toBe("full");
    for (let i = 0; i < 40; i++) b.sample(100); b.resetWindow(); for (let i = 0; i < 45; i++) b.sample(16); expect(b.quality).toBe("full");
  });
});
describe("owned animation loop", () => {
  function harness() {
    let next = 0, updates = 0, expired = 0;
    const tasks = new Map<number, (time: number) => void>();
    const loop = new MotionLoop({ request: cb => { tasks.set(++next, cb); return next; }, cancel: id => { tasks.delete(id); } }, () => updates++, () => expired++);
    return { loop, tasks, updates: () => updates, expired: () => expired, tick(time: number) { const work = [...tasks.values()]; tasks.clear(); work.forEach(cb => cb(time)); } };
  }
  it("owns exactly one RAF and cleans on pause/dispose", () => {
    const h = harness(); h.loop.start(); h.loop.start(); expect(h.tasks.size).toBe(1); h.tick(100); expect(h.tasks.size).toBe(1);
    h.loop.pause(); expect(h.tasks.size).toBe(0); h.tick(200); expect(h.updates()).toBe(1);
    h.loop.start(); h.loop.dispose(); h.loop.dispose(); h.loop.start(); expect(h.tasks.size).toBe(0);
  });
  it("does not count hidden/paused time or jump when resumed", () => {
    const h = harness(); h.loop.start(); h.tick(0); h.tick(16); h.loop.pause(); h.loop.start(); h.tick(9000); expect(h.loop.elapsed).toBe(.016);
  });
  it("automatically stops after a bounded duration and can restart", () => {
    const h = harness(); h.loop.start(); for (let i = 0; i < 1100; i++) h.tick(i * 17);
    expect(h.expired()).toBe(1); expect(h.tasks.size).toBe(0); h.loop.restart(); h.loop.start(); expect(h.tasks.size).toBe(1);
  });
  it("does not extend the stop deadline after a long visible frame", () => {
    const h = harness(); h.loop.start(); h.tick(0); h.tick(19000); expect(h.expired()).toBe(1); expect(h.tasks.size).toBe(0);
  });
});
