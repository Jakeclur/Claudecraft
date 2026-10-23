// Copies public/ to docs/ for GitHub Pages and wraps index.html in a full HTML document.
// Run after changing anything in public/:  npm run build:docs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public'), out = path.join(root, 'docs');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const f = path.join(out, 'index.html');
const s = fs.readFileSync(f, 'utf8');
const i = s.indexOf('<canvas');
fs.writeFileSync(f, `<!doctype html>\n<html lang="en"><head>\n${s.slice(0, i)}</head><body>\n${s.slice(i)}</body></html>\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('docs/ rebuilt from public/');
