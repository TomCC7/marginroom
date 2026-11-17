#!/usr/bin/env bun
import {mkdtemp,mkdir,cp,symlink,readFile,writeFile,rm,lstat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(Bun.version,'1.4.4','Build with the pinned Bun version');
const repo=path.resolve(import.meta.dir,'..'),out=path.resolve(process.argv[2]||path.join(repo,'../deliverables'));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD'),sourceDirty=!!git('status','--porcelain');
assert(!sourceDirty,'Commit the source tree before building a versioned distribution');
const pkg=JSON.parse(await readFile(path.join(repo,'package.json'))),version='0.1.0-alpha.2';
const allow=JSON.parse(await readFile(path.join(repo,'release/publication-allowlist.json'))).paths;
const publicFiles=allow.filter(p=>p.startsWith('public/')&&!p.startsWith('public/metal-arm-plan'));
const stage=await mkdtemp(path.join(tmpdir(),'marginroom-build-'));
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
try{
 const runtime=git('ls-files','*.js','bin','lib').split('\n').filter(p=>!p.startsWith('test/')&&!p.startsWith('scripts/')&&!p.startsWith('public/'));
 for(const p of [...runtime,...publicFiles]){assert((await lstat(path.join(repo,p))).isFile(),p);await mkdir(path.dirname(path.join(stage,p)),{recursive:true});await cp(path.join(repo,p),path.join(stage,p));}
 await writeFile(path.join(stage,'package.json'),JSON.stringify({type:'module'}));await symlink(path.join(repo,'node_modules'),path.join(stage,'node_modules'));
 await mkdir(out,{recursive:true});
 const assets={};for(const p of publicFiles)assets[p]=await digest(path.join(stage,p));
 const manifests=[];
 for(const target of ['linux-x64','darwin-arm64','darwin-x64']){
  const dir=path.join(stage,target);await mkdir(dir);const binary=path.join(dir,'marginroom');
  const flags=['build','--compile',`--target=bun-${target}`,'--minify','--define','process.env.NODE_ENV=process.env.NODE_ENV','--no-compile-autoload-dotenv','--no-compile-autoload-bunfig','--no-compile-autoload-package-json','--asset','./public','bin/marginroom.mjs','--outfile',binary];
  execFileSync(process.execPath,flags,{cwd:stage,stdio:'inherit'});await chmod(binary,0o755);
  await cp(path.join(repo,'LICENSE'),path.join(dir,'LICENSE'));
  const file=`marginroom-${version}-${target}.tar.gz`;
  execFileSync('tar',['-czf',path.join(out,file),'-C',dir,'marginroom','LICENSE']);
  const manifest={version,sourceCommit,sourceDirty,bun:Bun.version,target,libc:target==='linux-x64'?'glibc':null,file,sha256:await digest(path.join(out,file)),binarySha256:await digest(binary),assets,dependencies:pkg.dependencies,runtimeVerified:target==='linux-x64'?'see bounded Linux verification':'NOT EXECUTED; cross-built only; no Developer ID/notarization'};
  manifests.push(manifest);await writeFile(path.join(out,`manifest-${target}.json`),JSON.stringify(manifest,null,2)+'\n');
 }
 let template=await readFile(path.join(repo,'scripts/install.sh'),'utf8');
 for(const [k,v] of Object.entries({VERSION:version,LINUX_SHA:manifests[0].sha256,ARM_SHA:manifests[1].sha256,X64_SHA:manifests[2].sha256}))template=template.replaceAll(`@${k}@`,v);
 await writeFile(path.join(out,'install.sh'),template,{mode:0o755});
 await cp(path.join(repo,'LICENSE'),path.join(out,'LICENSE'));
 await cp(path.join(repo,'release/RELEASE-NOTES.md'),path.join(out,'RELEASE-NOTES.md'));
 await writeFile(path.join(out,'manifest.json'),JSON.stringify({version,sourceCommit,sourceDirty,targets:manifests},null,2)+'\n');
 const files=[...manifests.map(m=>m.file),...manifests.map(m=>`manifest-${m.target}.json`),'manifest.json','install.sh','LICENSE','RELEASE-NOTES.md'];
 await writeFile(path.join(out,'SHA256SUMS'),(await Promise.all(files.map(async f=>`${await digest(path.join(out,f))}  ${f}`))).join('\n')+'\n');
 console.log(JSON.stringify({version,sourceCommit,sourceDirty,targets:manifests.map(({target,file,sha256})=>({target,file,sha256}))}));
}finally{await rm(stage,{recursive:true,force:true});}
