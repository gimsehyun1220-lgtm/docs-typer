import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const archive = resolve('release', `docs-typer-${version}.zip`);
mkdirSync('release', { recursive: true });
rmSync(archive, { force: true });
execFileSync('zip', ['-qr', archive, '.'], { cwd: 'dist' });
console.log(archive);
