#!/usr/bin/env bun
import {mkdtemp,mkdir,cp,symlink,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(Bun.version,'1.4.4','Build with the pinned Bun version');
assert(process.platform==='linux'&&process.arch==='x64','Only Linux x64 glibc is verified');
const repo=path.resolve(import.meta.dir,'..'),out=path.resolve(process.argv[2]||path.join(repo,'../deliverables'));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const sourceCommit=git('rev-parse','HEAD'),sourceDirty=!!git('status','--porcelain');
assert(!sourceDirty,'Commit the source tree before building a versioned distribution');
const pkg=JSON.parse(await readFile(path.join(repo,'package.json'))),version=pkg.version+'-'+sourceCommit.slice(0,12),name=`marginroom-${version}-linux-x64`;
const allow=JSON.parse(await readFile(path.join(repo,'release/publication-allowlist.json'))).paths;
const publicFiles=allow.filter(p=>p.startsWith('public/')&&!p.startsWith('public/metal-arm-plan'));
const stage=await mkdtemp(path.join(tmpdir(),'marginroom-build-'));
try{
 const runtime=git('ls-files','*.js','bin','lib').split('\n').filter(p=>!p.startsWith('test/')&&!p.startsWith('scripts/')&&!p.startsWith('public/'));
 for(const p of [...runtime,...publicFiles]){assert((await lstat(path.join(repo,p))).isFile(),p);await mkdir(path.dirname(path.join(stage,p)),{recursive:true});await cp(path.join(repo,p),path.join(stage,p));}
 await writeFile(path.join(stage,'package.json'),JSON.stringify({type:'module'}));await symlink(path.join(repo,'node_modules'),path.join(stage,'node_modules'));
 await mkdir(out,{recursive:true});
 const flags=['build','--compile','--target=bun-linux-x64','--minify','--define','process.env.NODE_ENV=process.env.NODE_ENV','--no-compile-autoload-dotenv','--no-compile-autoload-bunfig','--no-compile-autoload-package-json','--asset','./public','bin/marginroom.mjs','--outfile',path.join(out,name)];
 execFileSync(process.execPath,flags,{cwd:stage,stdio:'inherit'});
 const sha256=createHash('sha256').update(await readFile(path.join(out,name))).digest('hex');
 const template=await readFile(path.join(repo,'scripts/install.sh'),'utf8');await writeFile(path.join(out,'install.sh'),template.replace("DEFAULT_VERSION=''",`DEFAULT_VERSION='${version}'`).replace("DEFAULT_SHA256=''",`DEFAULT_SHA256='${sha256}'`),{mode:0o755});
 await cp(path.join(repo,'LICENSE'),path.join(out,'LICENSE'));
 const assets={};for(const p of publicFiles)assets[p]=createHash('sha256').update(await readFile(path.join(stage,p))).digest('hex');
 const manifest={version,sourceCommit,sourceDirty,bun:Bun.version,target:'linux-x64',libc:'glibc',file:name,sha256,assets,dependencies:pkg.dependencies};
 await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await writeFile(path.join(out,'SHA256SUMS'),`${sha256}  ${name}\n`);
 console.log(JSON.stringify({file:path.join(out,name),sha256,version,sourceCommit,sourceDirty}));
}finally{await rm(stage,{recursive:true,force:true});}
