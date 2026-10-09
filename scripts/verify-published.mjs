import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scannerDir = process.env.SCANNER_DIR;
assert.ok(scannerDir, 'SCANNER_DIR is required');
const expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const url = 'https://registry.npmjs.org/' + encodeURIComponent(pkg.name) + '/' + encodeURIComponent(pkg.version);
let metadata;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      metadata = await response.json();
      break;
    }
    if (response.status !== 404) throw new Error('Registry HTTP ' + response.status);
  } catch (error) {
    console.log('Registry check: ' + error.message);
  }
  console.log('Waiting for ' + pkg.name + '@' + pkg.version + ' (' + (attempt + 1) + '/60)');
  if (attempt < 59) await delay(10000);
}
assert.ok(metadata, 'Version did not appear on npm within the waiting period; check the GitHub publish run');
assert.equal(metadata.gitHead, expectedCommit, 'Published version must originate from this exact source commit');
assert.ok(metadata.dist?.attestations?.provenance, 'Published version has no npm provenance');

const result = spawnSync(process.execPath, [
  path.join(scannerDir, 'scanner', 'cli.mjs'), pkg.name + '@' + pkg.version,
], { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
const output = (result.stdout ?? '') + (result.stderr ?? '');
fs.writeFileSync('scan.log', output);
process.stdout.write(output);
assert.ifError(result.error);
assert.equal(result.status, 0, 'n8n scanner process failed');
// The scanner can exit 0 on a failed verification.
assert.ok(output.includes('has passed all security checks'), 'n8n community package verification failed');
