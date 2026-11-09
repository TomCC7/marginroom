// GET-only fixture: no live documents, comments, or network server.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {launchBrowser,isolate,syntheticFixture,openFixture} from './helpers/browser.mjs';
const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
assert.match(readme,/isolated sandbox/);
assert.match(readme,/Runtime-generated text cannot be reliably written back/);
assert.match(readme,/Downloads retain the original active content/);
assert.match(readme,/Only open exported HTML from authors you trust/);
const browser=await launchBrowser();
const out=process.env.DISCLOSURE_ARTIFACTS;
if(out)await mkdir(out,{recursive:true});
try {
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    const fixture=syntheticFixture();
    fixture.doc.hasRaw=true;
    const raw='<!doctype html><html><body><h1>Sandbox disclosure fixture</h1><p>Source text stays reviewable.</p><script>document.body.dataset.booted="yes"</script></body></html>';
    const evidence=await isolate(context,fixture);
    await context.route('**/api/raw/synthetic',route=>route.fulfill({json:{rawHtml:raw}}));
    const page=await context.newPage();
    await openFixture(page);
    const warning=page.locator('#hs-warn');
    assert.equal(await warning.textContent(),'');
    assert.equal(await warning.evaluate(n=>n.getBoundingClientRect().height),0,'standing explanation reserves no space');
    assert.equal(await page.getByText(/This document runs its own JavaScript/).count(),0);
    const iframe=page.locator('#hs-doc-root>iframe');
    assert.equal(await iframe.getAttribute('sandbox'),'allow-scripts');
    const frame=page.frames().find(f=>f!==page.mainFrame());
    await frame.waitForFunction(()=>document.body.dataset.booted==='yes');
    assert.equal(await frame.evaluate(()=>{try{return !!parent.document}catch{return false}}),false);
    assert.equal(await frame.locator('p').textContent(),'Source text stays reviewable.');
    // Preserve genuine error feedback: invalid dimensions must still be announced.
    await page.selectOption('#preview-mode','custom');
    await page.locator('#preview-width').fill('-1');
    await page.locator('#preview-custom button').click();
    assert.match(await page.locator('#preview-error').textContent(),/240/);
    if(out)await page.screenshot({path:`${out}/${width}-interactive-no-banner.png`});
    assert.deepEqual(evidence.errors,[]);
    assert.deepEqual(evidence.writes,[]);
    await context.close();
  }
  console.log('PASS disclosure docs, 1440/390 no banner/space, actual script execution with opaque sandbox, source text and real validation notices; GET-only.');
} finally {await browser.close();}
