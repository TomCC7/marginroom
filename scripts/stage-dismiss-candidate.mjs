// CURRENT is read-only. Apply only this task's six frontend semantic deltas.
import {readFile,writeFile,mkdir,cp,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const [source,destination]=process.argv.slice(2);
assert(source&&destination,'usage: node scripts/stage-dismiss-candidate.mjs CURRENT NEW_CANDIDATE');
const current=path.resolve(source),out=path.resolve(destination),repo=process.cwd();
assert(out!==current&&!out.startsWith(current+path.sep)&&out!==repo&&out.startsWith(repo+'/review-artifacts/'),'independent review-artifacts candidate required');
assert(!await lstat(out).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e}),'candidate must not exist');
const baseline='fd183176ddbd8538c12e7ad59cfb4a53edfb6ddb';
const overlay=['public/element-review.js','public/frame-controller.js','public/review-v3.css','public/review-v3.js','public/static-frame-controller.js','public/viewer.html'];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('status','--porcelain'),'','stage only a clean reviewed release commit');
assert.deepEqual(git('diff','--name-only',baseline,'HEAD','--','public').split('\n').filter(Boolean).sort(),overlay);
const roots=['db.js','server.js','source-patch.js','guardrails.js','feedback-api.js','package.json','package-lock.json'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root){const files=[...roots];async function walk(dir,prefix){for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;assert(!e.isSymbolicLink(),'symlink refused '+rel);if(e.isDirectory())await walk(path.join(dir,e.name),rel);else if(e.isFile())files.push(rel);else throw Error('irregular file '+rel)}}await walk(path.join(root,'public'),'public');return files.sort()}
const beforeFiles=await inventory(current),before=new Map();for(const f of beforeFiles)before.set(f,sha(await readFile(path.join(current,f))));
await mkdir(out,{recursive:true});await cp(path.join(current,'public'),path.join(out,'public'),{recursive:true});for(const f of roots)await cp(path.join(current,f),path.join(out,f));
const patch=execFileSync('git',['diff','--binary',baseline,'HEAD','--',...overlay]);
const patchPath=path.join(out,'release-semantic.patch');await writeFile(patchPath,patch);
execFileSync('git',['apply','--check','--directory='+path.relative(repo,out),patchPath]);execFileSync('git',['apply','--directory='+path.relative(repo,out),patchPath]);
assert.deepEqual(await inventory(current),beforeFiles,'CURRENT inventory drift');for(const [f,h] of before)assert.equal(sha(await readFile(path.join(current,f))),h,'CURRENT hash drift '+f);
const rows=[];for(const f of await inventory(out)){const after=sha(await readFile(path.join(out,f))),prior=before.get(f)||null;assert(prior===after||overlay.includes(f),'unallowlisted delta '+f);rows.push({path:f,before:prior,after,changed:prior!==after})}
assert.deepEqual(rows.filter(r=>r.changed).map(r=>r.path),overlay);
const manifest={kind:'dismiss-current-derived-v1',releaseCommit:git('rev-parse','HEAD'),taskBaseline:baseline,liveHead:execFileSync('git',['-C',current,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),overlay,inventory:rows};
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({releaseCommit:manifest.releaseCommit,files:rows.length,changed:overlay,preserved:rows.filter(r=>!r.changed).map(r=>r.path)},null,2));
