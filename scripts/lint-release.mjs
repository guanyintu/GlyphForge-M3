import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
execFileSync('git',['diff','--check'],{stdio:'pipe'});
execFileSync('git',['diff','--cached','--check'],{stdio:'pipe'});
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(f=>/\.(?:[cm]?[jt]sx?|ya?ml|sql|toml)$/.test(f));
for(const f of files) {
 const text=readFileSync(f,'utf8');
 if(/^(?:<{7}|>{7}|={7}) /m.test(text))throw new Error('Unresolved merge marker: '+f);
 if(f.startsWith('.github/workflows/')&&/pull_request_target|write-all|secrets\.[A-Za-z_]*(?:PAT|TOKEN)/i.test(text))throw new Error('Unsafe workflow privilege: '+f);
}
console.log(`Release source/merge/workflow lint passed (${files.length} tracked source files); typecheck handles TS syntax.`);
