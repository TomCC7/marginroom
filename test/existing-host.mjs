// Narrow review130 regression: normal createApp (not managed runner), installed CLI.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=await mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'marginroom-host-'));
await mkdir(root+'/docs');
Object.assign(process.env,{HS_DB_PATH:root+'/app.db',HS_DOCS_DIR:root+'/docs',SESSION_SECRET:'synthetic-host-session',OWNER_KEY:'synthetic-host-owner'});
const {installFixture}=await import('./helpers/install.mjs');
const {cli}=await installFixture(root);
const {openDb}=await import('../db.js');
const {createApp}=await import('../server.js');
let db=openDb(),server,origin;
async function start(port=0){server=createApp(db).listen(port,'127.0.0.1');await new Promise((r,j)=>{server.once('listening',r);server.once('error',j)});origin='http://127.0.0.1:'+server.address().port;}
async function stop(){await new Promise(r=>server.close(r));db.close();}
async function call(args,exit=0){let r;try{r=await exec(cli,[...args,'--data-dir',root+'/client','--json'],{cwd:root,env:{...process.env,PATH:'/nonexistent'}});assert.equal(exit,0,r.stdout)}catch(e){assert.equal(e.code,exit,e.stdout||e.message);r=e}assert.equal(r.stderr,'');return JSON.parse(r.stdout)}
const info=()=>fetch(origin+'/api/instance',{headers:{Connection:'close'}}).then(r=>r.json());
try{
 await start();const first=await info(),port=server.address().port;
 for(const headers of [{},{authorization:'Bearer '+'A'.repeat(43)},{'x-owner-key':'synthetic-host-owner'}]){
  const response=await fetch(origin+'/api/machine/pair',{method:'POST',headers:{...headers,Connection:'close','Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,headers.authorization?401:403);
 }
 assert.equal((await call(['pair','--server',origin,'--out',root+'/unauthorized.json'],2)).error.code,'invalid_arguments');
 // Supported host-local operation requires explicit access to the original database.
 assert.deepEqual(await call(['pair','--host-db',root+'/app.db','--server',origin,'--out',root+'/pair.json']),{schemaVersion:1,paired:true});
 const credential=JSON.parse(await readFile(root+'/pair.json'));assert.equal(credential.instanceId,first.instanceId);assert.equal((await stat(root+'/pair.json')).mode&0o777,0o600);
 assert.equal(db.prepare('SELECT count(*) n FROM machine_credentials').get().n,1);
 const wrong=openDb(root+'/other.db');createApp(wrong);wrong.close();
 assert.equal((await call(['pair','--host-db',root+'/other.db','--server',origin,'--out',root+'/wrong.json'],6)).error.code,'incompatible_instance');
 await writeFile(root+'/article.html','<p>Existing host exact persisted content</p>');
 const args=['open',root+'/article.html','--server',origin,'--token-file',root+'/pair.json'];
 const opened=await call(args);assert.equal(opened.instanceId,first.instanceId);
 const oldSource=await (await fetch(origin+'/api/doc/'+opened.document,{headers:{Connection:'close'}})).json();
 const oldOwner=db.prepare('SELECT * FROM doc_owners WHERE doc_id=?').get(opened.document);
 await stop();db=openDb();await start(port);
 assert.equal((await info()).instanceId,first.instanceId);
 const reopened=await call(args);assert.equal(reopened.document,opened.document);assert.equal(reopened.reused,true);
 assert.deepEqual(await (await fetch(origin+'/api/doc/'+opened.document,{headers:{Connection:'close'}})).json(),oldSource);
 assert.deepEqual(db.prepare('SELECT * FROM doc_owners WHERE doc_id=?').get(opened.document),oldOwner);
 const comments=await call(['comments',opened.reviewUrl,'--server',origin,'--token-file',root+'/pair.json']);assert.equal(comments.complete,true);
 const {digest}=await import('../machine-auth.js');
 db.prepare('UPDATE machine_credentials SET revoked=1 WHERE hash=?').run(digest(credential.token));
 assert.equal((await call(args,4)).error.code,'invalid_machine_credential');
 // Explicit remote and host-local operations never created a managed service.
 await assert.rejects(stat(root+'/client/service.json'),{code:'ENOENT'});
 const {machineInstance}=await import('../machine-auth.js');
 const adopted=openDb(root+'/managed-upgrade.db');assert.equal(machineInstance(adopted,'preserved-managed-instance'),'preserved-managed-instance');adopted.close();
 const adoptedAgain=openDb(root+'/managed-upgrade.db');assert.equal(machineInstance(adoptedAgain),'preserved-managed-instance');assert.throws(()=>machineInstance(adoptedAgain,'conflicting-instance'),/machine_instance_mismatch/);adoptedAgain.close();
 const result={root,checks:['managed identity adoption preserved; conflicting identity fails closed','anonymous/owner/invalid Bearer pairing denied','installed host-local bootstrap original DB and origin, 0600 secret-free JSON','wrong DB rejected','normal createApp + DB reopen keeps instance, source, old owners and installed credential','same review reused and comments readable after restart','revocation fails closed; no managed service'],instanceId:first.instanceId,document:opened.document};
 if(process.env.HOST_ARTIFACTS){await mkdir(process.env.HOST_ARTIFACTS,{recursive:true});await writeFile(process.env.HOST_ARTIFACTS+'/existing-host.json',JSON.stringify(result,null,2));}
 console.log('PASS '+result.checks.join('\nPASS '));
}finally{if(server?.listening)await stop();}
