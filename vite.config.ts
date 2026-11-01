import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
const base = process.env.GLYPHFORGE_BASE || "/";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !key.startsWith("sb_publishable_"))
    throw new Error(
      "Only a Supabase publishable key may enter the browser build",
    );
  const publicNames=new Set(['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY']);
  if(Object.keys(env).some(k=>k.startsWith('VITE_') && env[k] && !publicNames.has(k)))
    throw new Error('Only approved public Supabase variables may use VITE_');
  if(key && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    throw new Error('Invalid publishable key format');
  if(env.VITE_SUPABASE_URL) {
    const url=new URL(env.VITE_SUPABASE_URL);
    if(url.username||url.password||url.search||url.hash||
      (url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))))
      throw new Error('Supabase URL must be HTTPS or local HTTP, without embedded credentials');
  }
  if (!/^\/(?:[\p{L}\p{N}_-]+\/)*$/u.test(base))
    throw new Error(
      "GLYPHFORGE_BASE must be an absolute repository path ending in /",
    );
  return {
    base,
    plugins: [
      react(),
      {
        name: "glyphforge-offline-assets",
        apply: "build",
        generateBundle(_options, bundle) {
          const paths = Object.keys(bundle).filter((p) => !p.endsWith(".map"));
          const prefix = "glyphforge-static-" + encodeURIComponent(base) + "-";
          const cache =
            prefix +
            createHash("sha256")
              .update(paths.join("|"))
              .digest("hex")
              .slice(0, 16);
          // Static assets only. No Auth/API responses, local user data, or remote code.
          this.emitFile({
            type: "asset",
            fileName: "offline-worker.js",
            source: `
const CACHE=${JSON.stringify(cache)},PREFIX=${JSON.stringify(prefix)};
const FILES=${JSON.stringify(["", ...paths])}.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!FILES.includes(u.href))return;e.respondWith(caches.open(CACHE).then(async c=>{if(u.href===self.registration.scope){try{return await fetch(e.request);}catch{return await c.match(u.href);}}return await c.match(u.href)||fetch(e.request);}));});
`,
          });
        },
      },
    ],
    worker: { format: "es" },
    server: { port: 5173, strictPort: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "react-flow": ["@xyflow/react"],
            storage: ["dexie", "dexie-react-hooks"],
          },
        },
      },
    },
  };
});
