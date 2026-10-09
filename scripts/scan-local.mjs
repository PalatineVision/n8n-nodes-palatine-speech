// Runs the lint part of `npx @n8n/scan-community-package` before publishing.
// The official CLI only scans packages already on npm with GitHub provenance,
// so here we call the same analyzer on the source tree and on the packed tarball.
//
// Usage: SCANNER_DIR=<path to installed @n8n/scan-community-package> node scripts/scan-local.mjs <unpacked tarball dir>
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scannerDir = process.env.SCANNER_DIR;
const packageDir = process.argv[2];
if (!scannerDir || !packageDir) {
	process.stderr.write('Usage: SCANNER_DIR=<scanner package dir> node scripts/scan-local.mjs <unpacked package dir>\n');
	process.exit(2);
}

const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(
	pathToFileURL(path.join(scannerDir, 'scanner', 'scanner.mjs')).href
);

// Same file scopes as analyzePackageByName: full rules on sources, compiled JS + package.json on the tarball.
const results = [
	['source', await analyzePackage(process.cwd(), SOURCE_FILE_PATTERNS)],
	['package', await analyzePackage(path.resolve(packageDir), ['**/*.js', 'package.json'])],
];

let failed = false;
for (const [label, result] of results) {
	process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${label}${result.message ? `: ${result.message}` : ''}\n`);
	if (result.details) process.stdout.write(`${result.details}\n`);
	if (!result.passed) failed = true;
}
process.exit(failed ? 1 : 0);
