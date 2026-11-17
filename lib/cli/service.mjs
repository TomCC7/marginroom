import {mkdir,rm,open,stat,rename} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJSON,atomic} from './profile.mjs';
import {instance,CliError} from './client.mjs';
import {importLimitEnv,importLimits,IMPORT_ENV} from '../../import-limits.js';
const pause=()=>new Promise(r=>setTimeout(r,100));
export async function localService(dir){
 const stateFile=path.join(dir,'service.json'),lock=path.join(dir,'start.lock');
 async function ready(){const state=await readJSON(stateFile);if(!state)return null;let info;try{info=await instance(state.origin,state.instanceId);}catch{return null;}
  if(IMPORT_ENV.some(k=>process.env[k]!==undefined)){const desired=importLimits(),actual=info.importLimits;if(!actual||['file','total','count'].some(k=>desired[k]!==actual[k]))throw new CliError('import_policy_mismatch',`Running managed service import policy differs: file=${actual?.file??'unknown'}, total=${actual?.total??'unknown'}, count=${actual?.count??'unknown'}. Restart that owned service with the intended configuration.`,5);}
  return {...state,...await readJSON(path.join(dir,'credentials.json'))};}
 const reused=await ready();if(reused)return reused;
 let locked=false;
 for(let i=0;i<350;i++){try{await mkdir(lock,{mode:0o700});locked=true;await atomic(path.join(lock,'owner.json'),{pid:process.pid});break;}catch(e){if(e.code!=='EEXIST')throw e;
  const found=await ready();if(found)return found;
  const owner=await readJSON(path.join(lock,'owner.json'));let alive=true;if(owner){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}
  // A child may outlive a crashed launcher. Wait for its publication before reclaiming.
  const age=Date.now()-(await stat(lock).catch(()=>({mtimeMs:Date.now()}))).mtimeMs;if((!alive||!owner)&&age>30000){try{await rename(lock,lock+'.stale-'+process.pid);await rm(lock+'.stale-'+process.pid,{recursive:true,force:true});}catch{}}
  await pause();}}
 if(!locked)throw new CliError('start_locked','Another launcher is still starting; retry shortly',3);
 try{const found=await ready();if(found)return found;
 const log=path.join(dir,'service.log');try{if((await stat(log)).size>1_000_000)await rename(log,log+'.previous');}catch{}
 const out=await open(log,'a',0o600);const child=spawn(process.execPath,[...(Bun.isStandaloneExecutable?[]:[fileURLToPath(new URL('../../bin/marginroom.mjs',import.meta.url))]),'--service',dir],{detached:true,stdio:['ignore',out.fd,out.fd],env:{PATH:process.env.PATH,HOME:process.env.HOME,LD_LIBRARY_PATH:process.env.LD_LIBRARY_PATH,...importLimitEnv()}});child.unref();await out.close();
 for(let i=0;i<250;i++){const result=await ready();if(result)return result;await pause();}throw new CliError('start_failed','Local service did not become ready; inspect private service.log',3);
 }finally{await rm(lock,{recursive:true,force:true});}
}
