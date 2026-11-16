// A private Unix-domain lease lives for the runner's lifetime. It prevents a
// second producer even if its launcher dies before publishing the HTTP address.
import net from 'node:net';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function runnerLease(dir){
 // Linux abstract sockets leave no stale filesystem entry and release on crash.
 // Windows/macOS are not claimed by this Linux verified service manager.
 if(process.platform!=='linux')throw new Error('Local service currently requires Linux; use --server on other platforms');
 const socket='\0marginroom-'+createHash('sha256').update(path.resolve(dir)).digest('hex');
 const server=net.createServer(s=>s.end());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});return server;
}
