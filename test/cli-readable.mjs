import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync} from 'node:fs';
import path from 'node:path';
import {argumentsFor} from '../lib/cli/arguments.mjs';
import {threads,safe,shellQuote} from '../lib/cli/render.mjs';
const r={id:'00000000-0000-4000-8000-000000000001',status:'open',kind:'comment',author:'Synthetic Owl',quote:'Unicode 世界',body:'First line\nSecond line',replies:[{author:'Synthetic Fox',body:'Reply\n世界'}]};
assert.match(threads([r]),/^1 open comment · 1 reply\n/);assert.match(threads([r]),/ID  00000000-0000-4000-8000-000000000001/);assert.match(threads([]),/No feedback/);
assert.match(threads([r,{...r,status:'accepted',kind:'rewrite',quote:'old',base_text:'context NOT original',body:'new',replies:[]}]),/^1 open comment · 1 accepted revision · 1 reply/);
const revision=threads([{...r,kind:'rewrite',quote:'',body:'inserted',base_text:'not original'}]);assert.match(revision,/Original quote:\n  \nSuggested:\n  inserted/);assert(!revision.includes('not original'));
for(const control of ['\x1b[31mred\x1b[0m','\x1b]8;;https://invalid\x07link\x1b]8;;\x07','\x1b]52;c;clipboard\x07','\x9b31mred','\r\b\x00'])assert(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(safe(control)));
assert.equal(safe('世界\nline\ttab'),'世界\nline\ttab');assert(!threads([{...r,body:'\x1b]52;c;bad\x07safe'}]).includes('bad'));assert.match(threads([r],{color:true}),/\x1b\[36m/);assert(!threads([r],{color:false}).includes('\x1b'));assert.equal(shellQuote("a'b"),"'a'\\''b'");
const dir=mkdtempSync(path.join(process.env.TMPDIR,'cli-help-')),entry=new URL('../bin/marginroom.mjs',import.meta.url).pathname;
const call=args=>spawnSync(process.execPath,[entry,...args,'--data-dir',dir+'/absent'],{encoding:'utf8'});
for(const args of [['--help'],['open','--help'],['comments','--help'],['pair','--help']]){const p=call(args);assert.equal(p.status,0,p.stderr);assert(!p.stdout.includes('--service'));assert(!existsSync(dir+'/absent'));}
for(const args of [['comments','--json'],['open','--wat','--json'],['--json','open','--assets-dir'],['comments','https://example.invalid/viewer.html?doc=x','--status','wrong','--json'],['pair','--json'],['open','x','--browser','--json']]){const p=call(args);assert.equal(p.status,2,p.stdout);assert.equal(p.stderr,'');assert(JSON.parse(p.stdout).error);assert(!existsSync(dir+'/absent'));}
const help=call(['comments','--help']).stdout;assert(!help.includes('--assets-dir'));assert(!help.includes('--browser'));assert(help.includes('--status'));assert(help.includes('--json'));
assert(threads([{...r,quote:'&lt;tag&gt;',body:'A &amp; B &amp;lt;literal&amp;gt;'}]).includes('A & B &lt;literal&gt;'));
for(const args of [['--json','--data-dir','state','open','file','--include-resource','one','--include-resource','two'],['--include-resource','one','open','file','--include-resource','two','--json','--data-dir','state']]){const parsed=argumentsFor(args);assert.equal(parsed.values['data-dir'],'state');assert.equal(parsed.values.json,true);assert.deepEqual(parsed.values['include-resource'],['one','two']);}
for(const status of ['open','accepted','rejected','stale','withdrawn'])assert(threads([{...r,status}]).includes(`[${status}]`));
const wrapped=threads([{...r,body:'a'.repeat(200)+'\n世界'}],{width:40,color:false});assert(wrapped.includes('  '+'a'.repeat(38)+'\n'));assert(wrapped.includes('  世界'));assert(wrapped.includes(r.id));
console.log('PASS readable zero/one/mixed threads, replies, revisions, Unicode/newlines, terminal controls, color, quoting; Commander help and JSON errors without state side effects');
