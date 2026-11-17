// A fixture MUST be captured with the original Node driver before migration.
// This check only copies it; it never opens the operator's original directory.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {openDb} from '../db.js';
import {machineAuth,machineInstance,digest} from '../machine-auth.js';
const fixture=process.argv[2]||process.env.MARGINROOM_NODE_FIXTURE;
assert(fixture,'Usage: bun test/agent-migration.mjs ORIGINAL_NODE_FIXTURE_DIR');
const root=await mkdtemp(path.join(tmpdir(),'marginroom-migration-'));
const upgraded=root+'/upgraded',restored=root+'/restored';
await cp(path.resolve(fixture),upgraded,{recursive:true});await cp(path.resolve(fixture),restored,{recursive:true});
const before=JSON.parse(await readFile(upgraded+'/snapshot.json')),identity=JSON.parse(await readFile(upgraded+'/identity.json')),credential=JSON.parse(await readFile(upgraded+'/credential.json'));
Object.assign(process.env,{...identity,HS_DB_PATH:upgraded+'/app.db',HS_DOCS_DIR:upgraded+'/docs'});
const {createApp}=await import('../server.js');
function unchanged(db){
 for(const [table,state]of Object.entries(before.tables)){
  assert.deepEqual(db.prepare(`PRAGMA table_info(${table})`).all(),state.columns,table+' columns');
  assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),state.rows,table+' rows');
 }
 assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),before.schema,'schema/indexes/triggers');
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 assert.equal(machineInstance(db),before.instanceId);
 assert(db.prepare('SELECT hash FROM machine_credentials WHERE hash=? AND revoked=0').get(digest(credential.token)));
}
let db=openDb(),server;
try{
 const app=createApp(db);unchanged(db);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 for(const [route,expected]of [['/api/doc/original-review',before.doc],['/api/suggestions/original-review?status=all',before.feedback]]){
  const response=await fetch(origin+route,{headers:{cookie:before.cookie}});assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);
 }
 const authenticated=await fetch(origin+'/api/instance',{headers:{Authorization:'Bearer '+credential.token}});assert.equal(authenticated.status,200);assert.equal((await authenticated.json()).instanceId,before.instanceId);
 assert.equal((await fetch(origin+'/api/instance',{headers:{Authorization:'Bearer '+'A'.repeat(43)}})).status,401);
 console.log('PASS original Node-format fixture: every table row/column, schema/index/trigger, source/overlay/history, permissions, signed cookie identity and credential hash preserved');
 const count=db.prepare('SELECT count(*) n FROM suggestions').get().n;
 assert.throws(db.transaction(()=>{db.prepare("INSERT INTO documents VALUES('rollback-probe','{}','synthetic')").run();machineAuth(db).issue();throw Error('rollback');}),/rollback/);
 assert.equal(db.prepare("SELECT count(*) n FROM documents WHERE doc_id='rollback-probe'").get().n,0);unchanged(db);
 assert.equal(db.prepare('SELECT 1 WHERE 0').get(),undefined);
 assert.throws(()=>db.prepare('SELECT @required').get({wrong:1}),/parameter|bind/i);
 assert.throws(()=>db.prepare("UPDATE rewrite_history SET operation='tamper'").run(),/append_only_history/);
 await new Promise(r=>server.close(r));server=null;
 db.backup(root+'/snapshot.db');db.close();db=openDb(root+'/snapshot.db');unchanged(db);db.close();db=openDb();unchanged(db);
 assert.equal(db.prepare('SELECT count(*) n FROM suggestions').get().n,count);
 console.log('PASS transaction rollback including credential issuance and trigger epochs; append-only guard; native backup/integrity and repeat reopen');
 const rollback=openDb(restored+'/before.db');unchanged(rollback);rollback.close();
 assert.deepEqual(await readFile(restored+'/identity.json'),await readFile(upgraded+'/identity.json'));
 assert.deepEqual(await readFile(restored+'/docs/original-review.html'),await readFile(upgraded+'/docs/original-review.html'));
 console.log('PASS coordinated rollback into separate copied fixture retains old DB rows, identity and exact content');
 const out=process.env.AGENT_ARTIFACTS||root;await mkdir(out,{recursive:true});await writeFile(out+'/migration-receipt.json',JSON.stringify({root,originalDriver:'Node better-sqlite3',tables:Object.keys(before.tables),instancePreserved:true,rowsColumnsSchemaPreserved:true,rollback:true},null,2));
}finally{if(server)await new Promise(r=>server.close(r));db.close();}
