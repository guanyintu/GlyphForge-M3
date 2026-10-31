import fs from 'node:fs';
import os from 'node:os';
const read=file=>JSON.parse(fs.readFileSync(file));
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2;};
function summarize(r){return [...new Set(r.samples.map(s=>s.name))].map(name=>{
 const group=r.samples.filter(s=>s.name===name),modes={};
 for(const optimize of [false,true]){const samples=group.filter(s=>typeof s.round==='number'&&s.optimize===optimize),times=samples.map(s=>s.wallMs).sort((a,b)=>a-b);modes[optimize?'on':'off']={n:samples.length,medianWallMs:median(times),p95ObservedWallMs:times[Math.ceil(times.length*.95)-1],minWallMs:times[0],maxWallMs:times.at(-1),medianEngineMs:median(samples.map(s=>s.stats.duration)),steps:[...new Set(samples.map(s=>s.stats.steps))],outputCounts:[...new Set(samples.map(s=>s.rows))],medianOutputPerSecond:median(samples.map(s=>s.rows/s.wallMs*1000)),logical:samples[0].logical};}
 if(name.includes('reject-full'))for(const [key,optimize]of [['off',false],['on',true]])modes[key].medianCompletedOuterCombinationsPerEngineSecond=median(group.filter(s=>typeof s.round==='number'&&s.optimize===optimize).map(s=>s.logical/s.stats.duration*1000));
 return {name,...modes,onOverOff:modes.off.medianWallMs/modes.on.medianWallMs,profile:group.find(s=>s.round==='profiled')};
});}
const current=read('docs/p2-f/worker-full.json'),baseline=read('docs/p2-f/worker-baseline.json');
fs.writeFileSync('docs/p2-f/performance-summary.json',JSON.stringify({environment:{node:process.version,platform:os.platform(),release:os.release(),arch:os.arch(),cpus:os.cpus()[0]?.model,chromium:current.ua},method:'Alternating on/off; six samples per mode, three seeds repeated twice. p95 is nearest-rank observed maximum with n=6, not a population estimate. All workers cold; IDB/OS caches not reset.',current:summarize(current),p2EBaseline:summarize(baseline),imports:current.imports,reverseRenderer:current.reverse},null,2));
for(const s of summarize(current))console.log(`${s.name}: off/on median ${s.off.medianWallMs.toFixed(2)}/${s.on.medianWallMs.toFixed(2)}ms; p95 ${s.off.p95ObservedWallMs.toFixed(2)}/${s.on.p95ObservedWallMs.toFixed(2)}; ratio ${s.onOverOff.toFixed(3)}`);
