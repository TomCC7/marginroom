import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {elementReview} from '../public/element-review.js';
import {sha256hex} from '../public/anchoring.js';
// Entirely synthetic table/section diagram. No user document or quotes.
const html='<main><section id="diagram"><table><tbody><tr><td><section><p class="same"><strong>Model A</strong><br><span>Reference B</span></p><p class="same"><strong>Model A</strong><br><span>Reference B</span></p></section></td><td hidden><section><p class="same"><strong>Model A</strong><br><span>Reference B</span></p></section></td></tr></tbody></table></section><button id="late">Action</button></main>';
const open=(source=html,hash=sha256hex)=>{const dom=new JSDOM(source,{pretendToBeVisual:true}),root=dom.window.document.querySelector('main'),picker=elementReview({root,hash,enabled:()=>true,onPick:()=>{}});return {dom,root,picker}};
const {dom,root,picker}=open(),ps=[...root.querySelectorAll('p')],anchors=await Promise.all(ps.map(n=>picker.anchor(n)));
for(let i=0;i<ps.length;i++)assert.equal(await picker.resolve(anchors[i]),ps[i],'explicit repeated selected identity must immediately resolve');
assert.equal(new Set(anchors).size,3);
const reload=open();for(let i=0;i<ps.length;i++)assert.equal(await reload.picker.resolve(anchors[i]),reload.root.querySelectorAll('p')[i],'reload keeps the exact structural identity');
// Annotation wrappers, controls, generated classes do not enter identity.
ps[1].querySelector('span').innerHTML='<span data-review-comment="s" data-review-mark>Reference B</span><button data-review-point>1</button>';
ps[1].classList.add('hs-selected','record-focus');root.insertAdjacentHTML('beforeend','<div data-review-overlay>UI</div>');
assert.equal(await picker.anchor(ps[1]),anchors[1]);assert.equal(await picker.resolve(anchors[1]),ps[1]);
const decorated=open(root.outerHTML);assert.equal(await decorated.picker.resolve(anchors[1]),decorated.root.querySelectorAll('p')[1]);
// Scope topology is integrity-bound, never a bare nth-child fallback.
const inserted=open();inserted.root.querySelector('p').before(inserted.root.querySelector('p').cloneNode(true));assert.equal(await inserted.picker.resolve(anchors[1]),null);
const removed=open();removed.root.querySelector('p').remove();assert.equal(await removed.picker.resolve(anchors[1]),null);
const changed=open();changed.root.querySelectorAll('p')[1].textContent='Different source';assert.equal(await changed.picker.resolve(anchors[1]),null);
// A positive binding may not reattach to a same-HTML replacement in-session.
const late=root.querySelector('#late'),la=await picker.anchor(late);late.replaceWith(late.cloneNode(true));assert.equal(await picker.resolve(la),null);
// Misses are not permanent: startup/poll may run before runtime target appears.
const delayed=open('<main></main>');assert.equal(await delayed.picker.resolve(anchors[0]),null);delayed.root.innerHTML=html.match(/<main>(.*)<\/main>/s)[1];assert.equal(await delayed.picker.resolve(anchors[0]),delayed.root.querySelector('p'));
// Strict legacy c2 can recover only an exact unique signature, not by quote.
const legacy='c2:'+await sha256hex(JSON.stringify(['button',['id','late']]));assert.equal(await delayed.picker.resolve(legacy),delayed.root.querySelector('#late'));
const unknown='c2:'+await sha256hex(JSON.stringify(['button',['id','future']]));assert.equal(await delayed.picker.resolve(unknown),null);delayed.root.insertAdjacentHTML('beforeend','<button id="future">New</button>');assert.equal(await delayed.picker.resolve(unknown),delayed.root.querySelector('#future'));
// Hashing while source mutates must not publish a stale locator.
let resume;const race=open(html,s=>new Promise(r=>{resume=()=>sha256hex(s).then(r)}));const pending=race.picker.anchor(race.root.querySelector('p'));await new Promise(r=>setTimeout(r,0));race.root.querySelector('p').textContent='Changed during hash';resume();assert.equal(await pending,null);
for(const x of [dom,reload.dom,decorated.dom,inserted.dom,removed.dom,changed.dom,delayed.dom,race.dom])x.window.close();
console.log('PASS versioned repeated/hidden/nested identity, reload, decoration invariance, insert/delete/change refusal, detached binding, recoverable c2/c3 misses and async hash race');
