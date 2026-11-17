// Parent-only offline code cutover. Never manages services or opens a database.
import {readFile,readdir,lstat,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const [mode,candidate,target,backup,ack]=process.argv.slice(2);
assert(['check','install','rollback'].includes(mode)&&candidate&&target&&backup,'usage: check|install|rollback CANDIDATE STOPPED_TARGET NEW_BACKUP [--writers-stopped]');
const C=path.resolve(candidate),T=path.resolve(target),B=path.resolve(backup);
assert(C!==T&&!B.startsWith(T+path.sep)&&B!==T&&!T.startsWith(B+path.sep),'independent candidate/target/backup required');
const manifest=JSON.parse(await readFile(path.join(C,'manifest.json'),'utf8')),rows=manifest.inventory;
for(const root of [C,T]){assert((await lstat(root)).isDirectory(),'root must be a real directory');assert((await lstat(path.join(root,'public'))).isDirectory(),'public must be a real directory')}
assert(rows.length&&new Set(rows.map(r=>r.path)).size===rows.length);
for(const r of rows)assert.equal(r.changed,r.before!==r.after,'manifest changed flag inconsistent');
for(const r of rows)assert(/^(public\/[a-zA-Z0-9_./-]+|db\.js|server\.js|source-patch\.js|revision-service\.js|guardrails\.js|feedback-api\.js|package\.json|bun\.lock|lib\/sqlite\.mjs)$/.test(r.path)&&!r.path.split('/').includes('..'));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function digest(root,f){try{assert((await lstat(path.join(root,f))).isFile(),'not regular file: '+f);return sha(await readFile(path.join(root,f)))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function inventory(root){const files=[];async function walk(dir,prefix){for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+e.name;assert(!e.isSymbolicLink(),'symlink refused: '+rel);if(e.isDirectory())await walk(path.join(dir,e.name),rel);else files.push(rel)}}await walk(path.join(root,'public'),'public');for(const f of ['db.js','server.js','source-patch.js','revision-service.js','guardrails.js','feedback-api.js','package.json','bun.lock','lib/sqlite.mjs'])if(await digest(root,f))files.push(f);return files.sort()}
const expected=rows.filter(r=>mode==='rollback'||r.before!==null).map(r=>r.path).sort();
assert.deepEqual(await inventory(T),expected,'full inventory differs; rebuild/review, do not overwrite');
for(const r of rows){assert.equal(await digest(C,r.path),r.after,'candidate hash drift '+r.path);assert.equal(await digest(T,r.path),mode==='rollback'?r.after:r.before,'target hash drift '+r.path)}
if(mode==='check'){console.log('PASS full CURRENT inventory and all candidate before/after hashes');process.exit(0)}
assert.equal(ack,'--writers-stopped','Parent must freeze writes/stop service and back up DB+docs+identity first');
if(mode==='install'){
 await mkdir(B);await mkdir(path.join(B,'code'));for(const r of rows.filter(r=>r.before!==null)){await mkdir(path.dirname(path.join(B,'code',r.path)),{recursive:true});await copyFile(path.join(T,r.path),path.join(B,'code',r.path))}
 await copyFile(path.join(C,'manifest.json'),path.join(B,'manifest.json'));
}else{
 assert.deepEqual(JSON.parse(await readFile(path.join(B,'manifest.json'),'utf8')),manifest,'backup does not match candidate');
 for(const r of rows)assert.equal(await digest(path.join(B,'code'),r.path),r.before,'backup drift '+r.path);
}
for(const r of rows.filter(r=>r.changed)){if(mode==='rollback'&&r.before===null)await rm(path.join(T,r.path));else{await mkdir(path.dirname(path.join(T,r.path)),{recursive:true});await copyFile(path.join(mode==='rollback'?path.join(B,'code'):C,r.path),path.join(T,r.path))}}
for(const r of rows)assert.equal(await digest(T,r.path),mode==='rollback'?r.before:r.after,'post-write verification '+r.path);
console.log('PASS '+mode+' code readback; DB/docs/identity/services untouched. Keep write freeze until coordinated operator verification.');
