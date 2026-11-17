// Actual installed binary outside checkout, synthetic owned service only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';
import {installFixture} from './helpers/install.mjs';
const root=await mkdtemp(path.join(process.env.TMPDIR,'readable-installed-')),exec=promisify(execFile);
const {cli}=await installFixture(root),data=root+'/state',env={...process.env,PATH:root+'/empty',HOME:root+'/home'};await mkdir(env.PATH);await mkdir(env.HOME);let state;
const call=async args=>(await exec(cli,[...args,'--data-dir',data],{cwd:root,env})).stdout;
try{
 for(const args of [['--help'],['comments','--help']])assert.match(await call(args),/Usage:/);
 await assert.rejects(readFile(data+'/service.json'));
 await writeFile(root+'/article.html','<html><p>Readable synthetic 世界</p></html>');
 const opened=JSON.parse(await call(['open',root+'/article.html','--json']));state=JSON.parse(await readFile(data+'/service.json'));const creds=JSON.parse(await readFile(data+'/credentials.json'));
 const seed=await fetch(state.origin+'/');const cookie=seed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const api=async(route,body)=>{const r=await fetch(state.origin+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
 assert.match(await call(['comments',opened.reviewUrl]),/No feedback/);
 const one=await api('/api/suggest/'+opened.document,{kind:'comment',anchor:'c:synthetic',quote:'世界 quotation',body:'line one\nline two\x1b]52;c;unsafe\x07\x1b[31mred\x1b[0m',author:'Synthetic Owl'});
 await api(`/api/suggest/${opened.document}/${one.suggestion.id}/replies`,{body:'reply 世界\nsecond line',author:'Synthetic Fox'});
 const records=(await api('/api/suggestions/'+opened.document+'?status=all')).suggestions;
 const machine=JSON.parse(await call(['comments',opened.reviewUrl,'--status','all','--json']));assert.deepEqual(machine.records,records);assert.equal(machine.complete,true);assert.equal(machine.schemaVersion,1);
 if(process.env.MARGINROOM_BASELINE_ENTRY){const oldArgs=[process.env.MARGINROOM_BASELINE_ENTRY,'comments',opened.reviewUrl,'--status','all','--data-dir',data];const baseline=(await exec(process.execPath,oldArgs,{cwd:root})).stdout;assert.deepEqual(JSON.parse(baseline),machine);assert.equal(baseline,(await exec(process.execPath,[...oldArgs,'--json'],{cwd:root})).stdout);console.log('PASS baseline nonJSON/JSON and new installed JSON exact same real records/replies/fields/types/status/IDs');}
 const text=await call(['comments',opened.reviewUrl,'--status','all']);assert.match(text,/1 open comment · 1 reply/);assert(text.includes(one.suggestion.id));assert(text.includes('reply 世界\n    second line'));assert(text.includes('line one\n  line two'));assert(!text.includes('\x1b'));assert(!text.includes('unsafe'));assert(!text.includes('doc_id'));assert(!text.includes(creds.token));
 const normal=await call(['open',root+'/article.html']);assert(normal.includes(`marginroom comments '${opened.reviewUrl}'`));
 for(const args of [['comments','--json'],['open','--unknown','--json'],['open','--assets-dir','--json']]){let e;try{await call(args)}catch(error){e=error}assert.equal(e.code,2);assert.equal(e.stderr,'');assert(JSON.parse(e.stdout).error);}
 // Python stdlib allocates a real pseudo-TTY. Script path is explicit, no PATH runtime.
 const python=process.env.PYTHON||'/usr/bin/python3';await writeFile(root+'/pty_capture.py',`import os,pty,subprocess,sys\nm,s=pty.openpty()\np=subprocess.Popen(sys.argv[1:],stdout=s,stderr=subprocess.PIPE)\nos.close(s)\ndata=b''\nwhile True:\n try: data+=os.read(m,65536)\n except OSError: break\np.wait();os.close(m)\nsys.stdout.buffer.write(data)\n`);
 const args=[root+'/pty_capture.py',cli,'comments',opened.reviewUrl,'--data-dir',data];
 const tty=(await exec(python,args,{cwd:root,env:{...env,NO_COLOR:undefined}})).stdout;assert(tty.includes('\x1b[36m'));
 const plain=(await exec(python,args,{cwd:root,env:{...env,NO_COLOR:'1'}})).stdout;assert(!plain.includes('\x1b'));
 console.log('PASS installed default text + exact API/JSON records/reply/IDs; Unicode/newlines; control sanitation; redirect and real pseudoTTY/NO_COLOR; quoted open next command; JSON parse failures; no Node/Bun PATH; owned service only');
 if(process.env.READABLE_EVIDENCE){await mkdir(process.env.READABLE_EVIDENCE,{recursive:true});await writeFile(process.env.READABLE_EVIDENCE+'/readable.txt',text);await writeFile(process.env.READABLE_EVIDENCE+'/machine.json',JSON.stringify(machine,null,2));}
}finally{if(state){const cmd=await readFile(`/proc/${state.pid}/cmdline`,'utf8');assert(cmd.includes(data));process.kill(state.pid,'SIGTERM');}}
