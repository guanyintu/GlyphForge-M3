import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { MotionLoop } from "./loop";
import { FrameBudget, reconcileBodies, stepBodies } from "./physics";
import type { Body, Bounds, Quality } from "./physics";

export function useMotionPreference() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
const lowDevice = () => navigator.hardwareConcurrency <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** Mutable coordinates and DOM writes stay outside React's render loop. */
export function usePhysicsField(ref: RefObject<HTMLDivElement | null>, keys: string[], bounds: Bounds, enabled: boolean, moving: boolean, restart: number, onExpired: () => void) {
  const [quality, setQuality] = useState<Quality>(() => lowDevice() ? "low" : "full");
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const budget = useRef(new FrameBudget(lowDevice()));
  const bodies = useRef<Body[]>([]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const loop = useRef<MotionLoop | null>(null);
  const expired = useRef(onExpired); expired.current = onExpired;
  const box = useRef(bounds); box.current = bounds;
  const lastLayout = useRef(bounds);
  const [intersecting, setIntersecting] = useState(true);
  const signature = JSON.stringify(keys);
  // Stable primitive signature prevents a favorite update from restarting physics.
  const stableKeys: string[] = useMemo(() => JSON.parse(signature), [signature]);
  const paint = () => {
    for (const body of bodies.current) {
      const node = nodes.current.get(body.key);
      if (node) node.style.transform = `translate3d(${body.x.toFixed(2)}px,${body.y.toFixed(2)}px,0)`;
    }
  };
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const element = ref.current;
    let paints = 0, accumulator = 0;
    const current = new MotionLoop({ request: cb => requestAnimationFrame(cb), cancel: id => cancelAnimationFrame(id) }, (delta, elapsed, interval) => {
      if (interval > 0) {
        const next = budget.current.sample(interval);
        if (next !== qualityRef.current) { qualityRef.current = next; setQuality(next); }
      }
      if (qualityRef.current === "static") { current.pause(); element.dataset.physicsRunning = "false"; return; }
      accumulator += delta;
      if (qualityRef.current === "low" && accumulator < 1 / 30) return;
      stepBodies(bodies.current, box.current, elapsed, accumulator); accumulator = 0;
      paint(); element.dataset.physicsFrames = String(++paints);
    }, () => { element.dataset.physicsRunning = "false"; expired.current(); });
    loop.current = current;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting));
    observer.observe(element);
    return () => {
      observer.disconnect(); current.dispose(); element.dataset.physicsRunning = "false";
      nodes.current.forEach(node => { node.style.transform = ""; });
      loop.current = null; bodies.current = []; nodes.current.clear();
    };
    // All live frame data is read from refs; lifecycle depends only on mode.
  }, [enabled]);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    nodes.current = new Map(Array.from(ref.current.querySelectorAll<HTMLElement>("[data-candidate-key]")).map(n => [n.dataset.candidateKey!, n]));
    const resized = lastLayout.current.width !== bounds.width || lastLayout.current.height !== bounds.height;
    bodies.current = reconcileBodies(bodies.current, stableKeys, bounds, quality, Math.random, resized);
    lastLayout.current = bounds;
    ref.current.dataset.physicsCount = String(bodies.current.length);
    ref.current.dataset.quality = quality;
    paint();
  }, [enabled, stableKeys, bounds.width, bounds.height, quality]);
  useEffect(() => { loop.current?.restart(); }, [restart]);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const element = ref.current;
    const update = () => {
      const run = moving && stableKeys.length > 0 && !document.hidden && intersecting && quality !== "static";
      budget.current.resetWindow();
      if (run) loop.current?.start(); else loop.current?.pause();
      element.dataset.physicsRunning = String(run);
    };
    update(); document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); loop.current?.pause(); element.dataset.physicsRunning = "false"; };
  }, [enabled, moving, intersecting, stableKeys.length, quality, restart]);
  return quality;
}

/** FLIP retained visible DOM nodes only (virtualized rows never measure the full result set). */
export function useResultFlip(ref: RefObject<HTMLDivElement | null>, signature: string, enabled: boolean) {
  const positions = useRef(new Map<string, DOMRect>());
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-candidate-key]") ?? []);
    // Cancel our previous transition before measuring new layout positions.
    animations.current.forEach(a => a.cancel()); animations.current = [];
    const next = new Map(nodes.map(node => [node.dataset.candidateKey!, node.getBoundingClientRect()]));
    if (enabled) for (const node of nodes) {
      const key = node.dataset.candidateKey!, before = positions.current.get(key), after = next.get(key)!;
      if (!before) continue;
      const x = before.left - after.left, y = before.top - after.top;
      if (Math.abs(x) + Math.abs(y) > 1 && Math.abs(x) + Math.abs(y) < 1600)
        animations.current.push(node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0,0)" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }));
    }
    positions.current = next;
    return () => { /* Rects must survive the next layout effect; unmount handled below. */ };
  }, [signature, enabled]);
  useEffect(() => () => { animations.current.forEach(a => a.cancel()); positions.current.clear(); }, []);
}
