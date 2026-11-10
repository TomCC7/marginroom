import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {elementReview} from '../public/element-review.js';
import {sha256hex} from '../public/anchoring.js';
const html='<main id="document"><section id="card"><button id="stable">Action</button><img data-key="camera" alt="Camera"><button class="same">Same</button><button class="same">Same</button><svg><rect/></svg><canvas></canvas><iframe></iframe></section></main>';
const dom=new JSDOM(html,{pretendToBeVisual:true}),doc=dom.window.document,root=doc.querySelector('main');let enabled=true,picked=null,cancelled=0;
const install=(r,onPick=()=>{})=>elementReview({root:r,hash:sha256hex,enabled:()=>enabled,onPick,onCancel:()=>cancelled++});
const picker=install(root,t=>picked=t),button=doc.querySelector('#stable'),image=doc.querySelector('img');
const b=await picker.anchor(button),a=await picker.anchor(image);assert.match(a,/^c3:[a-f0-9]{64}:self$/);assert.equal(await picker.resolve(b),button);root.querySelector('section').append(button);assert.equal(await picker.resolve(b),button);
const cloneDom=new JSDOM(root.outerHTML,{pretendToBeVisual:true}),clone=cloneDom.window.document.querySelector('main'),reloaded=install(clone);assert.equal((await reloaded.resolve(b)).id,'stable');assert.equal((await reloaded.resolve(a)).getAttribute('data-key'),'camera');
const same=doc.querySelector('.same'),ambiguous=await picker.anchor(same);assert.equal(await picker.resolve(ambiguous),same);assert.equal(await reloaded.resolve(ambiguous),clone.querySelector('.same'));
// Removed/replaced nodes cannot silently rebind during this document lifetime.
button.remove();root.querySelector('section').insertAdjacentHTML('beforeend','<button id="stable">Action</button>');assert.equal(await picker.resolve(b),null);
const w=dom.window,el=doc.querySelector('img');for(const type of ['pointerdown','pointerup','click'])el.dispatchEvent(new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:20,clientY:20}));await new Promise(r=>setTimeout(r,360));assert.equal(picked.anchor,a);assert.equal(picked.isText,false);
await picker.navigate('parent');assert.match(picked.quote,/section #card/);await picker.navigate('child');assert.match(picked.quote,/img/);
// Keyboard target selection and Escape, no tab-index/source bookkeeping writes.
el.tabIndex=0;el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));assert.equal(picked.anchor,a);el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(cancelled);assert.equal(doc.querySelector('[data-review-overlay]').style.display,'none');
assert.equal(root.querySelectorAll('[data-hs-comment-anchor]').length,0);assert.equal(root.querySelectorAll('[data-review-overlay]').length,0);
enabled=false;let fired=0;el.addEventListener('click',()=>fired++);const event=new w.MouseEvent('click',{bubbles:true,cancelable:true});el.dispatchEvent(event);assert.equal(fired,1);assert.equal(event.defaultPrevented,false);
assert.equal(await picker.resolve('c2:invalid-selector[]'),null);dom.window.close();cloneDom.window.close();console.log('PASS ordinary picker identity/reorder/reload, identical ambiguity, detached replacement missing, keyboard/Escape/Browse, source DOM clean; canvas/iframe hosts supported, never internal nodes.');
