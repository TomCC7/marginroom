// Native driver semantics and the actual offline backup/restore commands.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDb} from '../db.js';
const root=await mkdtemp(path.join(tmpdir(),'marginroom-storage-')),source=root+'/source',backup=root+'/backup',restored=root+'/restored';
await mkdir(source+'/docs/bundles/synthetic',{recursive:true});
const identity=JSON.stringify({SESSION_SECRET:'synthetic-session-'.repeat(4),OWNER_KEY:'synthetic-owner-'.repeat(4)});
await writeFile(source+'/identity.json',identity,{mode:0o600});await writeFile(source+'/docs/source.html','<p>Synthetic original bytes</p>');await writeFile(source+'/docs/bundles/synthetic/asset.css','p{color:blue}');
const db=openDb(source+'/app.db');db.prepare('INSERT INTO documents VALUES(@id,@overlay,@ts)').run({id:'synthetic',overlay:'{"a":{"text":"retained overlay"}}',ts:'2026-01-01'});
assert.equal(db.prepare('SELECT 1 WHERE 0').get(),undefined);
assert.throws(db.transaction(()=>{db.prepare("INSERT INTO doc_owners VALUES('rolled-back','caller','synthetic','suggest')").run();throw Error('abort');}),/abort/);
assert.equal(db.prepare("SELECT 1 FROM doc_owners WHERE doc_id='rolled-back'").get(),undefined);
const before=db.prepare('SELECT * FROM documents').all();db.close();
function run(script,args){return execFileSync(process.execPath,[new URL('../scripts/'+script,import.meta.url).pathname,...args],{encoding:'utf8'});}
console.log(run('backup.mjs',[source,backup,'--writes-stopped']).trim());
console.log(run('restore.mjs',[backup,restored,'--writes-stopped']).trim());
const restoredDb=openDb(restored+'/app.db');assert.deepEqual(restoredDb.prepare('SELECT * FROM documents').all(),before);assert.equal(restoredDb.pragma('integrity_check',{simple:true}),'ok');restoredDb.close();
assert.deepEqual(JSON.parse(await readFile(restored+'/identity.json')),JSON.parse(identity));
for(const file of ['source.html','bundles/synthetic/asset.css'])assert.deepEqual(await readFile(restored+'/docs/'+file),await readFile(source+'/docs/'+file));
assert.throws(()=>run('backup.mjs',[source,backup,'--writes-stopped']));
await cp(backup,root+'/corrupt',{recursive:true});await writeFile(root+'/corrupt/docs/source.html','corrupted');assert.throws(()=>run('restore.mjs',[root+'/corrupt',root+'/refused','--writes-stopped']));
console.log('PASS strict named/positional binding, missing-row semantics, transaction rollback, actual backup+restore commands, nested bundles/identity/overlay integrity; existing backup and corrupted snapshot refused');
