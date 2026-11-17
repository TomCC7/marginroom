// These scripts await each case before closing their shared HTTP/SQLite fixture.
// Bun's queued test runner does not implement node:test's awaited registration.
export async function test(name,check) {
 await check();
 console.log('PASS '+name);
}
export default test;
