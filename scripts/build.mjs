// Copies app/ to dist/ and writes the git sha of the build into the page (plan R6).
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const sha = process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString().trim();
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
writeFileSync('dist/index.html', readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha));
writeFileSync('dist/.nojekyll', '');
console.log(`dist/ built at ${sha}`);
