// Read-only CURRENT inventory + only this card's semantic runtime deltas.
import {readFile,writeFile,mkdir,cp,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import path from 'node:path';import assert from 'node:assert/strict';
const [source,destination]=process.argv.slice(2),repo=process.cwd();
assert(source&&destination,'usage: bun scripts/stage-continuous-candidate.mjs CURRENT NEW_CANDIDATE');
const current=path.resolve(source),out=path.resolve(destination);
assert(out!==current&&!out.startsWith(current+path.sep)&&out.startsWith(repo+'/review-artifacts/'),'independent review-artifacts candidate required');
assert(!await lstat(out).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e}),'new candidate required');
const staleOnly=process.env.STALE_ONLY==='1';
const baseline=staleOnly?'534d1451a31cb82bceb9a721f78b98bd7da5a3fc':'a881608b4775b9e15865f7e798fe559e67af4cd5',git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('status','--porcelain'),'','clean exact source commit required');
const overlay=(staleOnly?['db.js','server.js','revision-service.js','public/annotation-affordances.js','public/review-v3.js','public/static-frame-controller.js']:['db.js','server.js','revision-service.js','public/inline-draft.js','public/review-v3.js','public/revision-diff.js','public/static-frame-controller.js','public/static-preview.js']).sort();
if(staleOnly){
 const approved=path.resolve('review-artifacts/continuous/candidate-fresh-run91');
 for(const f of ['db.js','server.js','revision-service.js','public/annotation-affordances.js','public/inline-draft.js','public/review-v3.js','public/revision-diff.js','public/static-frame-controller.js','public/static-preview.js'])assert((await readFile(path.join(current,f))).equals(await readFile(path.join(approved,f))),'CURRENT is not the approved continuous runtime: '+f);
}
assert.deepEqual(git('diff','--name-only',baseline,'HEAD','--','public','db.js','server.js','revision-service.js').split('\n').filter(Boolean).sort(),overlay);
const roots=['db.js','server.js','source-patch.js','revision-service.js','guardrails.js','feedback-api.js','package.json','bun.lock','lib/sqlite.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root){const files=[];for(const f of roots){const st=await lstat(path.join(root,f)).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(st){assert(st.isFile(),'regular core file required');files.push(f)}}async function walk(dir,prefix){for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;assert(!e.isSymbolicLink(),'symlink refused '+rel);if(e.isDirectory())await walk(path.join(dir,e.name),rel);else{assert(e.isFile());files.push(rel)}}}await walk(path.join(root,'public'),'public');return files.sort()}
const beforeFiles=await inventory(current),before=new Map();for(const f of beforeFiles)before.set(f,sha(await readFile(path.join(current,f))));
await mkdir(out,{recursive:true});await mkdir(path.join(out,'lib'),{recursive:true});await cp(path.join(current,'public'),path.join(out,'public'),{recursive:true});for(const f of roots.filter(f=>before.has(f)))await cp(path.join(current,f),path.join(out,f));
const patch=execFileSync('git',['diff','--binary',baseline,'HEAD','--',...overlay]),patchPath=path.join(out,'release-semantic.patch');await writeFile(patchPath,patch);
execFileSync('git',['apply','--check','--directory='+path.relative(repo,out),patchPath]);execFileSync('git',['apply','--directory='+path.relative(repo,out),patchPath]);
assert.deepEqual(await inventory(current),beforeFiles,'CURRENT inventory drift');for(const [f,h] of before)assert.equal(sha(await readFile(path.join(current,f))),h,'CURRENT bytes drift '+f);
const rows=[];for(const f of await inventory(out)){const after=sha(await readFile(path.join(out,f))),prior=before.get(f)||null;assert(prior===after||overlay.includes(f),'unallowlisted difference '+f);rows.push({path:f,before:prior,after,changed:prior!==after})}
const manifest={kind:'continuous-current-derived-v1',releaseCommit:git('rev-parse','HEAD'),taskBaseline:baseline,liveHead:execFileSync('git',['-C',current,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),overlay,inventory:rows};
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({releaseCommit:manifest.releaseCommit,files:rows.length,changed:rows.filter(r=>r.changed).map(r=>r.path)},null,2));
