// Reproducible, build-time acquisition only; no npm runtime dependency.
import {mkdir,writeFile,mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const version='27.1.1', integrity='sha512-Qq3aJizS3RXQ30crhx9BKQLrHoa6GKpgrOJjVZ9vgj3EBxAddrmVfDNUrAMxSUimw5Jc+ld4SSZUAzf1q4nGyQ==';
const url=`https://registry.npmjs.org/i18next/-/i18next-${version}.tgz`;
const response=await fetch(url);assert(response.ok);const bytes=Buffer.from(await response.arrayBuffer());
assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),integrity);
await mkdir('review-artifacts',{recursive:true});const temp=await mkdtemp('review-artifacts/vendor-');
try{await writeFile(temp+'/package.tgz',bytes);execFileSync('tar',['xzf',temp+'/package.tgz','-C',temp]);await mkdir('public/vendor',{recursive:true});for(const [source,target] of [['dist/umd/i18next.min.js','i18next-27.1.1.min.js'],['LICENSE','i18next-LICENSE']])await writeFile('public/vendor/'+target,await readFile(temp+'/package/'+source));}finally{await rm(temp,{recursive:true,force:true})}
console.log(`Vendored official i18next ${version}; integrity verified.`);
