// Populated legacy migration and coordinated rollback, disposable data only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const [current,candidate]=process.argv.slice(2);assert(current&&candidate);
const dir=await mkdtemp(path.join(process.env.TMPDIR,'continuous-cutover-'));
try{
 const legacy=path.join(dir,'legacy');await mkdir(legacy);await cp(path.join(current,'db.js'),path.join(legacy,'db.js'));await writeFile(path.join(legacy,'package.json'),'{"type":"module"}');await symlink(path.resolve('node_modules'),path.join(legacy,'node_modules'));
 const old=await import(pathToFileURL(path.join(legacy,'db.js'))),next=await import(pathToFileURL(path.resolve(candidate,'db.js')));
 const file=path.join(dir,'populated.db');let db=old.openDb(file);
 old.addSuggestion(db,{id:'legacy',doc_id:'synthetic',anchor:'fixture',quote:'cat',body:'CAT',kind:'rewrite',author:'same display name',created_at:'2020-01-01T00:00:00Z',base_text:'cat',range_start:0,range_end:3});
 db.prepare('INSERT INTO suggestion_replies(id,parent_id,body,author,created_at) VALUES(?,?,?,?,?)').run('reply','legacy','legacy discussion','review','2020-01-01T00:00:00Z');
 const before=old.listSuggestions(db,'synthetic','all');await db.backup(path.join(dir,'before.db'));db.close();
 for(let i=0;i<2;i++){db=next.openDb(file);assert.deepEqual(next.listSuggestions(db,'synthetic','all'),before);assert.equal(db.prepare('SELECT request_caller FROM suggestions WHERE id=?').get('legacy').request_caller,null);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close()}
 db=next.openDb(file);db.prepare("UPDATE suggestions SET body='CATS' WHERE id='legacy'").run();db.prepare("UPDATE suggestions SET status='withdrawn' WHERE id='legacy'").run();assert.equal(next.listSuggestions(db,'synthetic','open').length,0);assert.equal(next.listSuggestions(db,'synthetic','all')[0].replies.length,1);assert.equal(db.prepare('SELECT count(*) n FROM rewrite_history').get().n,2);db.close();
 // Old code can read additive data, but does NOT implement new update semantics.
 db=old.openDb(file);assert.equal(old.listSuggestions(db,'synthetic','all')[0].status,'withdrawn');assert.equal(old.listSuggestions(db,'synthetic','open').length,0);db.close();
 await cp(path.join(dir,'before.db'),path.join(dir,'restored.db'));db=old.openDb(path.join(dir,'restored.db'));assert.deepEqual(old.listSuggestions(db,'synthetic','all'),before);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 const r=spawnSync(process.execPath,['test/inline-cutover.mjs',current,candidate],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());console.log('PASS populated legacy upgrade twice, NULL provenance/replies preserved, withdrawal/history, old-code additive reads and coordinated pre-write SQLite restore.');
}finally{await rm(dir,{recursive:true,force:true})}
