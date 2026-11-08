// Explicit suites avoid silently running one-off acceptance scripts or helper files.
import { spawnSync } from 'node:child_process';
const suites = {
  unit: ['anchoring', 'formats', 'group', 'source-patch', 'sha256-fallback', 'frame-controller', 'frame-tabs', 'frame-suggest', 'frame-messages', 'span-select', 'feedback', 'identity', 'viewer-ui', 'anchoring-inline', 'scope-css', 'mode-policy', 'review-ranges'],
  api: ['api', 'suggestions', 'upload', 'interactive', 'guardrails', 'access', 'owner-promotion', 'v3-api'],
};
const selected = process.argv.slice(2);
for (const suite of selected.length ? selected : ['unit', 'api']) {
  if (!suites[suite]) throw Error(`Unknown suite ${suite}`);
  for (const name of suites[suite]) {
    const result = spawnSync(process.execPath, [new URL(`${name}.test.mjs`, import.meta.url).pathname], { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
  console.log(`${suite}: ${suites[suite].length} test files passed`);
}
