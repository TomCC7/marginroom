// A process-owned lease releases on crash without stale filesystem locks.
import net from 'node:net';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function runnerLease(dir){
 const hash=createHash('sha256').update(path.resolve(dir)).digest();
 const server=net.createServer(s=>s.end());
 // macOS has no Linux abstract sockets. An exclusive loopback TCP listener
 // provides the same kernel-owned lifetime. Hash collisions fail closed: choose
 // another state directory; never steal a port or assume an existing listener is us.
 const address=process.platform==='linux'?'\0marginroom-'+hash.toString('hex'):
  process.platform==='darwin'?{host:'127.0.0.1',port:49152+hash.readUInt16BE(0)%16384,exclusive:true}:null;
 if(!address)throw new Error('Local service requires Linux or macOS');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});return server;
}
