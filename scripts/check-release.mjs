import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
assert.equal(lock.version, pkg.version, 'package-lock.json version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version must match package.json');
assert.equal(lock.name, pkg.name, 'Lockfile package name must match package.json');
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'Verified n8n nodes must not have runtime dependencies');

const githubRepository = process.env.GITHUB_REPOSITORY;
if (githubRepository) {
  assert.match(githubRepository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid GitHub repository');
  assert.equal(
    pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''),
    'https://github.com/' + githubRepository,
    'package.json repository must match the public GitHub source used for provenance',
  );
}
const tag = process.env.CI_COMMIT_TAG ||
  (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '');
if (tag) {
  assert.match(tag, /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'Only stable vX.Y.Z release tags are supported');
  assert.equal(tag, 'v' + pkg.version, 'Release tag must match package.json version');
}
console.log('Package metadata' + (tag ? ' and release tag ' + tag : '') + ' validated');
