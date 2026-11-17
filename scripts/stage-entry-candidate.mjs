// Read-only CURRENT snapshot plus a reviewed, explicit entry overlay. No deploy.
import {readFile,writeFile,mkdir,cp,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const [source,destination]=process.argv.slice(2);
assert(source&&destination,'usage: bun scripts/stage-entry-candidate.mjs CURRENT NEW_CANDIDATE');
const current=path.resolve(source),out=path.resolve(destination),repo=process.cwd();
assert(out!==current&&!out.startsWith(current+path.sep)&&out!==repo,'independent candidate required');
assert(!await lstat(out).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e}),'candidate must not exist');
const rootFiles=['db.js','server.js','source-patch.js','guardrails.js','feedback-api.js','package.json','bun.lock','lib/sqlite.mjs'];
export const overlay=['server.js','package.json','bun.lock','public/index.html','public/index.js','public/entry-history.js','public/entry-reading.js','public/review-v3.js','public/viewer.html','public/viewer.js','public/static-preview.js','public/static-frame-controller.js','public/frame-controller.js'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root){const files=[...rootFiles];async function walk(dir,prefix){for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;assert(!e.isSymbolicLink(),'symlink refused '+rel);if(e.isDirectory())await walk(path.join(dir,e.name),rel);else if(e.isFile())files.push(rel);else throw Error('irregular file '+rel)}}await walk(path.join(root,'public'),'public');return files.sort()}
const beforeFiles=await inventory(current),before=new Map();for(const f of beforeFiles)before.set(f,sha(await readFile(path.join(current,f))));
if(process.env.ENTRY_BASELINE_INVENTORY){
 const baseline=JSON.parse(await readFile(process.env.ENTRY_BASELINE_INVENTORY,'utf8'));
 for(const row of baseline.filter(row=>overlay.includes(row.path)))assert.equal(before.get(row.path)||null,row.sha256,'overlaid CURRENT path changed since integration began; reconcile/review '+row.path);
}
await mkdir(out,{recursive:true});await mkdir(path.join(out,'lib'),{recursive:true});await cp(path.join(current,'public'),path.join(out,'public'),{recursive:true});
for(const f of rootFiles)await cp(path.join(current,f),path.join(out,f));
for(const f of overlay){await mkdir(path.dirname(path.join(out,f)),{recursive:true});await cp(path.join(repo,f),path.join(out,f))}
assert.deepEqual(await inventory(current),beforeFiles,'CURRENT inventory drift while staging');
for(const [f,h] of before)assert.equal(sha(await readFile(path.join(current,f))),h,'CURRENT bytes drift while staging '+f);
const rows=[];for(const f of await inventory(out)){const after=sha(await readFile(path.join(out,f))),prior=before.get(f)||null;assert(prior===after||overlay.includes(f),'unallowlisted difference '+f);rows.push({path:f,before:prior,after,changed:prior!==after})}
const manifest={kind:'entry-current-derived-v1',releaseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),liveHead:execFileSync('git',['-C',current,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),overlay,inventory:rows};
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({releaseCommit:manifest.releaseCommit,files:rows.length,changed:rows.filter(r=>r.changed).map(r=>r.path),preserved:rows.filter(r=>!r.changed).map(r=>r.path)},null,2));
