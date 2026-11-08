// Never print scanner output: even a redacted scanner report may contain an
// unredacted commit message. Only the explicit metadata below leaves memory.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const VERSION = '8.30.1';
const assets = {
  win32: ['windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
  linux: ['linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
};
const root = process.cwd();
function run(bin, args, options={}) {
  return spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,...options});
}
function git(args) {
  const r=run('git',args);if(r.status!==0)throw new Error('Git inventory failed');return r.stdout;
}
async function scanner() {
  if(process.arch!=='x64'||!assets[process.platform])throw new Error('Use GITLEAKS_BIN with pinned 8.30.1 on this platform');
  const dir=path.join(tmpdir(),'glyphforge-gitleaks-'+VERSION);
  mkdirSync(dir,{recursive:true});
  const exe=process.env.GITLEAKS_BIN||path.join(dir,process.platform==='win32'?'gitleaks.exe':'gitleaks');
  if(process.env.GITLEAKS_BIN&&!existsSync(exe))throw new Error('Configured scanner missing');
  if(!existsSync(exe)) {
    const [asset,sha]=assets[process.platform], archive=path.join(dir,'download-'+asset);
    let bytes;
    for (let attempt=0;attempt<3;attempt++) {
      try {
        const res=await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${asset}`,{signal:AbortSignal.timeout(30000)});
        if(!res.ok) {
          if(attempt<2 && (res.status===429 || res.status>=500)) { await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1))); continue; }
          throw new Error('Pinned scanner download failed');
        }
        bytes=Buffer.from(await res.arrayBuffer()); break;
      } catch(error) {
        if(attempt===2 || (error instanceof Error && error.message==='Pinned scanner download failed')) throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
      }
    }
    if(!bytes)throw new Error('Pinned scanner download failed');
    if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Scanner archive checksum mismatch');
    writeFileSync(archive,bytes);
    const unpack=process.platform==='win32'
      ? run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${dir.replaceAll("'","''")}' -Force`])
      : run('tar',['-xzf',archive,'-C',dir]);
    if(unpack.status!==0)throw new Error('Scanner extraction failed');
  }
  if(run(exe,['version']).stdout.trim()!==VERSION)throw new Error('Wrong Gitleaks version');
  return exe;
}
const config=fileURLToPath(new URL('./gitleaks.toml',import.meta.url));
const common=['--config',config,'--redact=100','--no-banner','--no-color','--log-level=error','--ignore-gitleaks-allow','--gitleaks-ignore-path',path.join(tmpdir(),'glyphforge-no-allow-file'), '--max-archive-depth=5','--max-decode-depth=5','--report-format=json','--report-path=-'];
export function safeFindings(rows) {
  return rows.map(r=>({rule:r.RuleID,file:r.File,line:r.StartLine,commit:r.Commit||undefined}));
}
async function main() {
  const exe=await scanner(), staged=process.argv.includes('--staged-only');
  const tracked=git(['ls-files','-z']).split('\0').filter(Boolean);
  // Ignoring credentials never protects an index entry. Block such paths even
  // when their contents do not match a known credential pattern.
  const forbidden=tracked.filter(p=>/(^|\/)(node_modules|\.env(?:\..*)?|\.npmrc|\.netrc|secrets|credentials|\.credentials|\.secrets)(\/|$)|\.(pem|p12|pfx|key|keystore|jks)$/i.test(p)&&!/(^|\/)\.env\.example$/.test(p));
  let files=0,bytes=0;
  const skipped=[];
  function inventory(dir,rel='') {
    for(const e of readdirSync(dir,{withFileTypes:true})) {
      const name=rel?rel+'/'+e.name:e.name;
      if(e.name==='.git'||e.name==='node_modules'){skipped.push(name);continue;}
      const f=path.join(dir,e.name),st=lstatSync(f);
      if(st.isSymbolicLink())throw new Error('Unscanned workspace symlink: '+name);
      if(e.isDirectory())inventory(f,name);else{files++;bytes+=st.size;}
    }
  }
  if(!staged)inventory(root);
  const scopes=staged?[['staged',['git',root,'--pre-commit','--staged']]]:[
    ['history-all-refs',['git',root,'--log-opts=--all --full-history']],
    ['staged',['git',root,'--pre-commit','--staged']],
    // Directory mode intentionally includes ignored/untracked files and dist.
    // The only excluded paths are .git internals and non-published dependencies.
    ['workspace-including-dist-workflows',['dir',root]],
    ['commit-messages',['stdin']],
  ];
  const reviewed=JSON.parse(readFileSync(fileURLToPath(new URL('./secret-scan-allowlist.json',import.meta.url)),'utf8'));
  const summary={reviewedFalsePositives:[],scanner:'gitleaks',version:VERSION,tracked:tracked.length,workspaceFiles:files,workspaceBytes:bytes,excluded:skipped,archiveDepth:5,decodeDepth:5,findings:[],scopes:[]};
  for(const [scope,args] of scopes) {
    const r=run(exe,[...args,...common],scope==='commit-messages'?{input:git(['log','--all','--format=%B'])}:{});
    if(![0,1].includes(r.status))throw new Error('Secret scanner failed in '+scope+'; raw output suppressed');
    let findings;try{findings=JSON.parse(r.stdout||'[]');}catch{throw new Error('Invalid scanner report in '+scope);}
    summary.scopes.push({scope,exit:r.status,findings:findings.length});
    const unresolved=findings.filter(f=>{
      const rel=path.relative(root,f.File).replaceAll('\\','/');
      const entry=scope==='workspace-including-dist-workflows'&&reviewed.find(a=>a.file===rel&&a.line===f.StartLine&&a.rule===f.RuleID);
      if(!entry)return true;
      const line=readFileSync(path.resolve(root,rel),'utf8').split(/\r?\n/)[f.StartLine-1];
      if(!line||createHash('sha256').update(line).digest('hex')!==entry.lineDigest)return true;
      summary.reviewedFalsePositives.push({file:rel,line:entry.line,rule:entry.rule,reason:entry.reason});return false;
    });
    summary.findings.push(...safeFindings(unresolved).map(f=>({scope,...f})));
  }
  summary.forbiddenTracked=forbidden;
  console.log(JSON.stringify(summary,null,2));
  if(summary.findings.length||forbidden.length){console.error('PUBLICATION BLOCKED. Review metadata privately; revoke/rotate any real credential. Never hide a leak with ignore rules.');process.exitCode=1;}
}
// Only these static diagnostics are safe to publish; never emit raw exceptions,
// scanner reports, request URLs, headers or commit messages.
export function safeScannerError(error) {
  const allowed=new Set(['Git inventory failed','Use GITLEAKS_BIN with pinned 8.30.1 on this platform','Configured scanner missing','Pinned scanner download failed','Scanner archive checksum mismatch','Scanner extraction failed','Wrong Gitleaks version']);
  return error instanceof Error && allowed.has(error.message) ? error.message : 'Unexpected scanner environment failure';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error('Secret scan failed closed: '+safeScannerError(error)+'; raw diagnostic output suppressed.');process.exitCode=1;});
}
