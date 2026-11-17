#!/usr/bin/env bun
// Persist container identity before guardrails reads the environment.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const file='/data/identity.json';
if(!existsSync(file))writeFileSync(file,JSON.stringify({SESSION_SECRET:process.env.SESSION_SECRET||randomBytes(32).toString('hex'),OWNER_KEY:process.env.OWNER_KEY||randomBytes(32).toString('hex')})+'\n',{mode:0o600,flag:'wx'});
const identity=JSON.parse(readFileSync(file,'utf8'));
for(const key of ['SESSION_SECRET','OWNER_KEY']){
 if(typeof identity[key]!=='string'||identity[key].length<32)throw Error('Invalid persisted identity: '+key);
 if(process.env[key]&&process.env[key]!==identity[key])throw Error('Environment conflicts with persisted '+key);
 process.env[key]=identity[key];
}
const {startServer}=await import('../server.js');await startServer();
