// Dedicated installed-package runner. No inherited production identity or seed docs.
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {atomic,readJSON} from './profile.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
const dir=process.argv[2];process.umask(0o077);
const {runnerLease}=await import('./lease.mjs');await runnerLease(dir);
const identityFile=path.join(dir,'identity.json');let identity=await readJSON(identityFile);if(!identity){identity={session:randomBytes(32).toString('hex'),instanceId:randomUUID()};await atomic(identityFile,identity);}
process.env.SESSION_SECRET=identity.session;process.env.OWNER_KEY='';process.env.HS_DOCS_DIR=path.join(dir,'documents');process.env.HS_DB_PATH=path.join(dir,'app.db');await mkdir(process.env.HS_DOCS_DIR,{recursive:true,mode:0o700});
const {openDb}=await import('../../db.js');const {machineAuth}=await import('../../machine-auth.js');const {createApp}=await import('../../server.js');
const db=openDb();const auth=machineAuth(db);let credentials=await readJSON(path.join(dir,'credentials.json'));if(!credentials){credentials=auth.issue();await atomic(path.join(dir,'credentials.json'),credentials);}
const previous=await readJSON(path.join(dir,'service.json'));
const preferred=previous ? Number(new URL(previous.origin).port) : 0;
const app=createApp(db,{instanceId:identity.instanceId});let server;
function listen(port){server=app.listen(port,'127.0.0.1',async()=>{await atomic(path.join(dir,'service.json'),{pid:process.pid,origin:`http://127.0.0.1:${server.address().port}`,instanceId:identity.instanceId});});server.on('error',error=>{if(error.code==='EADDRINUSE'&&port)listen(0);else process.exit(1);});}
listen(preferred);
