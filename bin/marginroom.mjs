#!/usr/bin/env node
import path from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {profile,readJSON,readCredential,atomic} from '../lib/cli/profile.mjs';
import {localService} from '../lib/cli/service.mjs';
import {request,instance,reviewURL,serverURL,CliError} from '../lib/cli/client.mjs';
import {collect} from '../lib/cli/collect.mjs';
let json=process.argv.includes('--json');
try{
 const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{json:{type:'boolean'},browser:{type:'boolean'},help:{type:'boolean'},'data-dir':{type:'string'},server:{type:'string'},'assets-dir':{type:'string'},'include-resource':{type:'string',multiple:true},'new-version-of':{type:'string'},status:{type:'string'},'token-file':{type:'string'},'host-db':{type:'string'},out:{type:'string'}}});
 if(v.help||!p.length){console.log('marginroom open FILE [--assets-dir DIR] [--new-version-of URL] [--browser] [--json]\nmarginroom comments URL [--status open|all|accepted|rejected|stale|withdrawn] --json\nmarginroom pair --out PRIVATE_JSON [--data-dir DIR]\nmarginroom pair --host-db EXISTING_DB --server ORIGIN --out PRIVATE_JSON\nOptions: --data-dir DIR; --server ORIGIN --token-file PRIVATE_JSON\nLocal links are loopback-only. See docs/agent-workflow.md.');process.exit(0);}
 if(p[0]==='pair'){
  if(p.length!==1||!v.out||Boolean(v.server)!==Boolean(v['host-db']))throw new CliError('invalid_arguments','Managed service: pair --out FILE [--data-dir DIR]; existing host: pair --host-db DB --server ORIGIN --out FILE');
  let service,credential;
  if(v['host-db']){
   // Explicit host filesystem authority only. Never start a service or borrow cookies.
   const origin=serverURL(v.server);if(origin.pathname!=='/'||origin.search)throw new CliError('invalid_server','Server must be an origin');
   const info=await instance(origin.origin);
   const {default:Database}=await import('better-sqlite3');const db=new Database(path.resolve(v['host-db']),{fileMustExist:true});
   try{
    const stored=db.prepare('SELECT id FROM machine_instance WHERE singleton=1').get();
    if(stored?.id!==info.instanceId)throw new CliError('incompatible_instance','Host database does not belong to the running server',6);
    const {machineAuth}=await import('../machine-auth.js');credential=machineAuth(db).issue();service={origin:origin.origin,instanceId:stored.id};
   }finally{db.close();}
  }else{
   const dir=await profile(v['data-dir']);service=await localService(dir);credential=await request(service.origin,'/api/machine/pair',{token:service.token,body:{}});
  }
  const {writeFile}=await import('node:fs/promises');await writeFile(path.resolve(v.out),JSON.stringify({token:credential.token,origin:service.origin,instanceId:service.instanceId}),{mode:0o600,flag:'wx'});console.log(json?JSON.stringify({schemaVersion:1,paired:true}):'Credential written to private file. Transfer it securely; never share it as a review link.');process.exit(0);
 }
 if(v['host-db'])throw new CliError('invalid_arguments','--host-db is only supported by pair');
 if(!['open','comments'].includes(p[0])||p.length!==2)throw new CliError('invalid_arguments','Expected open FILE or comments URL');
 if(v.browser&&v.json)throw new CliError('invalid_arguments','--browser and --json are mutually exclusive');
 const dir=await profile(v['data-dir']);let service;
 const supplied=v.server?serverURL(v.server):null;if(supplied&&(supplied.pathname!=='/'||supplied.search))throw new CliError('invalid_server','Server must be an origin');const explicit=supplied?.origin||null;
 if(p[0]==='comments'){
  const target=reviewURL(p[1]);if(explicit&&explicit!==target.origin)throw new CliError('server_mismatch','Review URL does not belong to --server');
  const local=await readJSON(path.join(dir,'service.json'));
  if(local?.origin===target.origin){await instance(local.origin,local.instanceId);service={...local,...await readJSON(path.join(dir,'credentials.json'))};}
  else{await instance(target.origin);const credentials=v['token-file']?await readCredential(path.resolve(v['token-file'])):null;if(!credentials?.token)throw new CliError('pairing_required','Use --token-file for an explicitly paired instance',4);await instance(target.origin,credentials.instanceId);service={origin:target.origin,token:credentials.token};}
  const status=v.status||'open';if(!['open','all','accepted','rejected','stale','withdrawn'].includes(status))throw new CliError('invalid_status','Unsupported status');
  const data=await request(service.origin,`/api/suggestions/${target.doc}?status=${status}`,{token:service.token});
  const records=data.suggestions;if(!Array.isArray(records))throw new CliError('invalid_response','Missing suggestions',6);
  console.log(JSON.stringify({schemaVersion:1,instanceId:(await instance(service.origin)).instanceId,document:target.doc,reviewUrl:p[1],status,complete:true,records}));
 }else{
  const {bundle,absolute}=await collect(p[1],v['assets-dir'],v['include-resource']);
  if(explicit){const info=await instance(explicit);const credentials=v['token-file']?await readCredential(path.resolve(v['token-file'])):null;if(!credentials?.token)throw new CliError('pairing_required','Use --token-file for an explicitly paired instance',4);await instance(explicit,credentials.instanceId);service={origin:explicit,instanceId:info.instanceId,token:credentials.token};}else service=await localService(dir);
  // Opaque deterministic per-profile source identity; do not transmit local paths.
  const {createHmac}=await import('node:crypto');const source=createHmac('sha256',service.token).update(absolute).digest('hex');
  let previous=null;if(v['new-version-of']){const target=reviewURL(v['new-version-of']);if(target.origin!==service.origin)throw new CliError('server_mismatch','Version parent belongs to another instance');previous=target.doc;}
  const result=await request(service.origin,'/api/imports',{token:service.token,body:{...bundle,source,previous}});
  const reviewUrl=`${service.origin}/viewer.html?doc=${result.document}`;
  if(v.browser){const {token}=await request(service.origin,'/api/management/handoff',{token:service.token,body:{doc:result.document}});const manage=`${service.origin}/claim.html#${token}`;const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';const child=spawn(command,[manage],{stdio:'ignore',detached:true});child.on('error',()=>console.error('Browser launch failed; share URL remains valid.'));child.unref();}
  console.log(v.json?JSON.stringify({schemaVersion:1,instanceId:service.instanceId,...result,reviewUrl,localOnly:!explicit,warnings:['Static declared dependencies only; dynamic resources and backend APIs are not replicated.',...(result.external.length?['External resources require network access.']:[])]}):reviewUrl);
 }
}catch(e){const error={code:e.code||'invalid_arguments',message:e.message};if(json)console.log(JSON.stringify({schemaVersion:1,error}));else console.error(`Error: ${error.message}`);process.exitCode=e.exit||2;}
