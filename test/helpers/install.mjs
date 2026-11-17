import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function installFixture(root){
 const release=path.resolve(process.env.MARGINROOM_DELIVERABLES||new URL('../../../deliverables',import.meta.url).pathname);
 const index=JSON.parse(await readFile(path.join(release,'manifest.json'))),manifest=index.targets.find(m=>m.target==='linux-x64');
 const bytes=await readFile(path.join(release,manifest.file));let corrupt=false,downloads=0;
 const server=http.createServer((req,res)=>{if(req.url!=='/'+manifest.file){res.writeHead(404);return res.end();}downloads++;res.end(corrupt?Buffer.from('corrupt archive'):bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const bin=path.join(root,'installed bin'),installer=path.join(release,'install.sh');
 try{
  const result=await exec('/bin/sh',[installer,'--from',origin,'--bin-dir',bin]);assert.match(result.stdout,/Installed Marginroom/);assert.match(result.stdout,/PATH/);
  const installed=await readFile(bin+'/marginroom');assert.equal((await import('node:crypto')).createHash('sha256').update(installed).digest('hex'),manifest.binarySha256);
  corrupt=true;await assert.rejects(exec('/bin/sh',[installer,'--from',origin,'--bin-dir',bin]),e=>/SHA256 mismatch/.test(e.stderr));assert.deepEqual(await readFile(bin+'/marginroom'),installed);corrupt=false;
  const shim=path.join(root,'unsupported');await mkdir(shim);await writeFile(shim+'/uname','#!/bin/sh\nprintf "Unsupported\\n"\n',{mode:0o755});
  await assert.rejects(exec('/bin/sh',[installer,'--from',origin,'--bin-dir',root+'/bad-target'],{env:{...process.env,PATH:shim+':'+process.env.PATH}}),e=>/Unsupported/.test(e.stderr));assert.equal(downloads,2);
  console.log('PASS installer real HTTP archive/hash, corrupt digest refusal preserving installed binary, unsupported target and spaces');return {cli:bin+'/marginroom',manifest,release};
 }finally{await new Promise(r=>server.close(r));}
}
