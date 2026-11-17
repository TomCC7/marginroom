import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {logicalText,logicalSelection,logicalRange,mathHidden} from '../public/logical-text.js';
import {assignAnchors,sha256hex} from '../public/anchoring.js';
const katex='<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>U</mi><mo>=</mo><mi>IR</mi></mrow><annotation encoding="application/x-tex">U=IR</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>U</span><span>=</span><span>IR</span></span></span>';
const native='<math><semantics><mrow><mi>U</mi><mo>=</mo><mi>IR</mi></mrow><annotation>U=IR</annotation></semantics></math>';
for(const formula of [katex,native,'<span class="katex"><span class="katex-html">U=IR</span></span>']){
 const d=new JSDOM(`<body><p id="p">😀前 ${formula} 后😀文</p><p>ordinary unchanged</p></body>`).window.document,p=d.querySelector('#p'),original=p.innerHTML;
 assert.equal(logicalText(p),'😀前 U=IR 后😀文');
 const map=await assignAnchors(d.body);assert.equal(p.dataset.hsAnchor,await sha256hex('😀前 U=IR 后😀文'));assert(map.has(await sha256hex('ordinary unchanged')));
 assert.equal(p.innerHTML,original);
 for(const [start,end] of [[0,4],[4,8],[8,logicalText(p).length],[0,logicalText(p).length],[10,12]]){const r=logicalRange(p,start,end);assert(r);assert.deepEqual(logicalSelection(p,r),{start,end,quote:logicalText(p).slice(start,end)});}
 assert.equal(logicalRange(p,0,99),null);
 const ann=p.querySelector('annotation');if(ann){assert(mathHidden(ann.firstChild));const r=d.createRange();r.selectNodeContents(ann);assert.equal(logicalSelection(p,r),null);}
}
const d=new JSDOM('<p>before <math><mfrac><mi>a</mi><mi>b</mi></mfrac></math> after</p>').window.document,p=d.querySelector('p');let r=d.createRange();r.selectNodeContents(p);assert.equal(logicalSelection(p,r),null);r.setStart(p.lastChild,1);r.setEnd(p.lastChild,6);assert.equal(logicalSelection(p,r).quote,'after');
console.log('PASS logical math: KaTeX/native/HTML-only, UTF-16 roundtrips, hidden annotation refusal, nonlinear fail-closed, unchanged ordinary hash and author DOM');
