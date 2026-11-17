// Finite smoke harness, run inside the built image with three fresh volumes.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile, mkdir} from 'node:fs/promises';
const cmd=['bun','scripts/docker-start.mjs'];
await mkdir('/app/test/.container-checks',{recursive:true});
let child;const base='http://127.0.0.1:3939';let logs='';
async function start(extra={}){child=spawn(cmd[0],cmd.slice(1),{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/whoami')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(logs);}
async function stop(){if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));child=null;}}
let cookie='';async function request(method,url,body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,url);return r.json();}
try{
 await start();
 const identity=await readFile('/data/identity.json','utf8'),{OWNER_KEY:key}=JSON.parse(identity);
 const promotion=await fetch(base+'/api/whoami',{headers:{'x-owner-key':key}});cookie=promotion.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');assert.equal((await promotion.json()).isOwner,true);
 await request('POST','/api/upload',{id:'container-synthetic',html:'<h1>Container synthetic</h1><p>Persistent text</p>'});
 await request('POST','/api/edit/container-synthetic',{anchor:'probe',text:'Synthetic persistent overlay'});
 assert.equal((await request('GET','/api/doc/container-synthetic')).isDocOwner,true);
 await stop();await start();assert.equal(await readFile('/data/identity.json','utf8'),identity);assert.equal((await request('GET','/api/whoami')).isOwner,true);
 assert.equal((await request('GET','/api/doc/container-synthetic')).overlay.probe.text,'Synthetic persistent overlay');await stop();
 for(const args of [['scripts/backup.mjs','/data','/app/test/.container-checks/backup','--writes-stopped'],['scripts/restore.mjs','/app/test/.container-checks/backup','/app/test/.container-restore','--writes-stopped']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});assert.equal(r.status,0);}
 assert.equal(await readFile('/app/test/.container-restore/identity.json','utf8'),identity);
 await start({HS_DB_PATH:'/app/test/.container-restore/app.db',HS_DOCS_DIR:'/app/test/.container-restore/docs'});assert.equal((await request('GET','/api/whoami')).isOwner,true);assert.equal((await request('GET','/api/doc/container-synthetic')).overlay.probe.text,'Synthetic persistent overlay');
 console.log('PASS final image exact CMD: fresh volume, HTTP startup, synthetic upload, owner cookie + restart, consistent backup, isolated restore + original identity/overlay.');
}finally{await stop();}
