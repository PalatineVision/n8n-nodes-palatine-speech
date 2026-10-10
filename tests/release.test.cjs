const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../scripts/check-release.mjs');
function check(t, { tag = '', version = '1.2.0', lockVersion = version, dependencies, repository = 'owner/repo', githubTag = false } = {}) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'palatine-release-test-'));
  t.after(() => {
    assert.equal(path.dirname(directory), tempRoot);
    assert.ok(path.basename(directory).startsWith('palatine-release-test-'));
    fs.rmSync(directory, { recursive: true });
  });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: 'n8n-nodes-example', version, dependencies,
    repository: { url: 'https://github.com/owner/repo.git' },
  }));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({
    name: 'n8n-nodes-example', version: lockVersion, packages: { '': { version: lockVersion } },
  }));
  return spawnSync(process.execPath, [script], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: repository, CI_COMMIT_TAG: githubTag ? '' : tag,
      GITHUB_REF_TYPE: githubTag ? 'tag' : 'branch', GITHUB_REF_NAME: githubTag ? tag : 'main' },
  });
}

test('release gate accepts branch checks and matching GitLab/GitHub stable tags', (t) => {
  for (const options of [{}, { tag: 'v1.2.0' }, { tag: 'v1.2.0', githubTag: true }]) {
    const result = check(t, options);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('release gate rejects mismatched and non-stable tags', (t) => {
  for (const tag of ['v1.2.1', 'v1.2.0-rc.1', 'v01.2.0', 'v1.2.0-extra', '1.2.0']) {
    const result = check(t, { tag });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must match|Only stable/);
  }
});

test('release gate rejects stale lockfile versions', (t) => {
  const result = check(t, { lockVersion: '1.1.1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version must match/);
});

test('release gate rejects runtime dependencies and a different provenance repository', (t) => {
  const deps = check(t, { dependencies: { axios: '*' } });
  assert.notEqual(deps.status, 0);
  assert.match(deps.stderr, /runtime dependencies/);
  const repo = check(t, { repository: 'another/repo' });
  assert.notEqual(repo.status, 0);
  assert.match(repo.stderr, /repository must match/);
});
