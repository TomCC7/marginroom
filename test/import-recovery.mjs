import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {openDb} from '../db.js';
import {documentImports} from '../document-imports.js';
import {digest} from '../machine-auth.js';
for(const phase of ['files-published','before-db-commit','committed']){
 const dir=await mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'mr-recovery-'));const result=spawnSync(process.execPath,['test/import-crash-worker.mjs',dir,phase]);assert.equal(result.status,73,result.stderr.toString());
 const db=openDb(dir+'/db.sqlite');const count=db.prepare('SELECT count(*) AS n FROM imported_documents').get().n;assert.equal(count,phase==='committed'?1:0);
 const imports=documentImports(db,dir,{stripActiveContent:s=>s});assert.equal((await readdir(dir+'/bundles')).length,count);
 const bytes=Buffer.from('<html><head></head><body><p>Synthetic crash fixture</p></body></html>');const input={entry:'index.html',source:'crash-fixture',files:[{path:'index.html',data:bytes.toString('base64'),sha256:digest(bytes)}]};const req={caller:{token:'synthetic-machine',machine:true},canManage:()=>true};
 const a=imports.import(req,input),b=imports.import(req,input);assert.equal(a.doc,b.doc);assert.equal(db.prepare('SELECT count(*) AS n FROM imported_documents').get().n,1);assert.deepEqual(await readFile(dir+'/'+a.doc+'.raw.html'),bytes);
 await db.backup(dir+'/backup.sqlite');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();const restored=openDb(dir+'/backup.sqlite');assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');assert.equal(restored.prepare('SELECT doc FROM imported_documents').get().doc,a.doc);restored.close();console.log('PASS abrupt exit '+phase+': no half publication; restart cleanup/idempotent retry; SQLite backup/readback');
}
