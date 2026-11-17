import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function installFixture(root){
 const release=path.resolve(process.env.MARGINROOM_DELIVERABLES||new URL('../../../deliverables',import.meta.url).pathname);
 const manifest=JSON.parse(await readFile(path.join(release,'manifest.json')));
 const bytes=await readFile(path.join(release,manifest.file));let downloads=0;
 const server=http.createServer((req,res)=>{if(req.url!=='/'+manifest.file){res.writeHead(404);return res.end();}downloads++;res.end(bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const bin=path.join(root,'installed bin'),installer=path.join(release,'install.sh');
 try{
  const result=await exec('/bin/sh',[installer,'--from',origin,'--bin-dir',bin]);assert.match(result.stdout,/Installed Marginroom/);assert.match(result.stdout,/not on PATH/);
  await assert.rejects(exec('/bin/sh',[installer,'--from',origin,'--bin-dir',bin,'--sha256','0'.repeat(64)]),e=>/SHA256 mismatch/.test(e.stderr));
  assert.deepEqual(await readFile(bin+'/marginroom'),bytes,'A refused download preserves the installed executable');
  await exec('/bin/sh',[installer,'--bin-dir',root+'/local copy bin']);
  assert.deepEqual(await readFile(root+'/local copy bin/marginroom'),bytes);
  const shim=path.join(root,'unsupported');await mkdir(shim);await writeFile(shim+'/uname','#!/bin/sh\nprintf "Unsupported\\n"\n',{mode:0o755});
  await assert.rejects(exec('/bin/sh',[installer,'--from',origin,'--bin-dir',root+'/bad-target'],{env:{...process.env,PATH:shim+':'+process.env.PATH}}),e=>/Unsupported target/.test(e.stderr));
  assert.equal(downloads,2,'Unsupported platform must fail before download');
  console.log('PASS installer local copy + real HTTP download/digest, corrupted digest refusal and unsupported target refusal; private install path with spaces');
  return {cli:bin+'/marginroom',manifest,release};
 }finally{await new Promise(r=>server.close(r));}
}
