#!/usr/bin/env bun
// Native installed CLI/service smoke for one built release target.
// Usage: bun test/release-native-installed.mjs DIST_DIR TARGET
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,stat,chmod,symlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
const dist=path.resolve(process.argv[2]??'');
const target=process.argv[3]??'';
assert(dist&&target,'usage: bun test/release-native-installed.mjs DIST_DIR TARGET');
assert.equal(`${process.platform==='darwin'?'darwin':process.platform}-${process.arch}`,target,'Native runner architecture mismatch');
const manifest=JSON.parse(await readFile(path.join(dist,`manifest-${target}.json`),'utf8'));
const base=process.env.TMPDIR||os.tmpdir();
const root=await mkdtemp(path.join(base,'marginroom-native-release-'));
const home=path.join(root,'home with spaces');
await mkdir(home,{recursive:true});
const sha256=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const run=async(file,args,options={})=>{const p=await exec(file,args,{env:{...process.env,...options.env},cwd:options.cwd,timeout:60000});return p;};
const cleanup=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/corrupt/')){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('corrupt archive');return;}
 const file=path.join(dist,decodeURIComponent(url.pathname.slice(1)));
 if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end('forbidden');return;}
 res.writeHead(200,{'Content-Type':'application/octet-stream'});
 res.end(readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
cleanup.push(()=>server.close());
const origin=`http://127.0.0.1:${server.address().port}`;
const installer=path.join(root,'install.sh');
await writeFile(installer,await readFile(path.join(dist,'install.sh'),'utf8'),{mode:0o755});
const tools=path.join(root,'runtime-free-tools');await mkdir(tools);
for(const name of ['sh','curl','tar','gzip','sha256sum','shasum','uname','getconf','mktemp','rm','mkdir','cp','chmod','mv']) {
 try {const src=execFileSync('/bin/sh',['-c','command -v "$1"','sh',name],{encoding:'utf8'}).trim();if(src)await symlink(src,path.join(tools,name));}catch{}
}
const env={...process.env,HOME:home,TMPDIR:root,PATH:tools};
for(const name of ['node','bun']) {let absent=false;try{await stat(path.join(tools,name))}catch{absent=true}assert(absent);}
const state=path.join(root,'state with spaces');
try {
await run('/bin/sh',[installer,'--from',origin],{env});
const binary=path.join(home,'.local/bin','marginroom');
assert((await stat(binary)).isFile());
assert.equal(await sha256(binary),manifest.binarySha256);
assert.equal((await stat(binary)).mode&0o777,0o755);
const cli=async(...args)=>(await run(binary,[...args,'--data-dir',state],{env})).stdout;
assert.match(await cli('--help'),/Usage:/);
const article=path.join(root,'article.html');
await writeFile(path.join(root,'fixture.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><text>synthetic asset</text></svg>');
await writeFile(article,'<!doctype html><title>Native release fixture</title><p id="test">Native synthetic release content.</p><img src="fixture.svg">');
const a=JSON.parse(await cli('open',article,'--json'));
assert(a.reviewUrl);
const servedOrigin=new URL(a.reviewUrl).origin;
for(const asset of ['viewer.html','viewer.js','review-v3.css']) {const response=await fetch(`${servedOrigin}/${asset}`);assert.equal(response.status,200);assert((await response.text()).length>100);}
const assetResponse=await fetch(`${servedOrigin}/bundles/${a.document}/fixture.svg`);
assert.equal(assetResponse.status,200);assert.match(await assetResponse.text(),/synthetic asset/);
const same=JSON.parse(await cli('open',article,'--json'));assert.equal(same.document,a.document);assert.equal(same.instanceId,a.instanceId);
assert.match(await cli('comments',a.reviewUrl),/./);
const comments=JSON.parse(await cli('comments',a.reviewUrl,'--json'));
assert.equal(comments.complete,true);
assert.deepEqual(comments.records,[]);
const service=JSON.parse(await readFile(path.join(state,'service.json'),'utf8'));

// Same file reuse/restart identity after a hard kill.
process.kill(service.pid,'SIGKILL');
await new Promise(resolve=>setTimeout(resolve,500));
const b=JSON.parse(await cli('open',article,'--json'));
assert.equal(b.instanceId,a.instanceId);
assert.equal(b.document,a.document);
// Parser errors still return JSON with exit code 2, no stderr.
let error;
try{await cli('open','--unknown','--json')}catch(e){error=e}
assert(error,'parser error expected');
assert.equal(error.code,2);
assert.equal(error.stderr,'');
assert(JSON.parse(error.stdout).error);
// Corrupt download refusal preserves installed executable.
const before=await sha256(binary);
let bad;
try{await run('/bin/sh',[installer,'--from',`${origin}/corrupt`],{env})}catch(e){bad=e}
assert(bad,'corrupt install should fail');
assert.match(bad.stderr,/SHA256 mismatch/);
assert.equal(await sha256(binary),before);
console.log(JSON.stringify({target,version:manifest.version,sourceCommit:manifest.sourceCommit,nativeSmoke:'PASS',runtimeVerified:true},null,2));
} finally {
 try {const latest=JSON.parse(await readFile(path.join(state,'service.json'),'utf8'));process.kill(latest.pid,'SIGTERM');}catch{}
 await Promise.all(cleanup.map(fn=>fn()));
}
