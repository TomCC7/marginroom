import {mkdir,readFile,writeFile,rename,chmod,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CliError} from './client.mjs';
export async function profile(dir){dir=path.resolve(dir||process.env.MARGINROOM_DATA_DIR||path.join(os.homedir(),'.local/share/marginroom'));await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);return dir;}
export async function readJSON(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function atomic(file,value){const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}

export async function readCredential(file){try{const info=await lstat(file);if(!info.isFile()||(info.mode&0o077)!==0)throw new Error();const data=await readJSON(file);if(!data||! /^[A-Za-z0-9_-]{43}$/.test(data.token)||typeof data.instanceId!=='string')throw new Error();return data;}catch{throw new CliError('invalid_credential_file','Expected a private regular JSON credential file (0600)',4);}}
