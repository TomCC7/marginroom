import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function profile(dir){dir=path.resolve(dir||process.env.MARGINROOM_DATA_DIR||path.join(os.homedir(),'.local/share/marginroom'));await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);return dir;}
export async function readJSON(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function atomic(file,value){const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
