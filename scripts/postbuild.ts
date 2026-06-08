// scripts/postbuild.ts
// Renames app.js/app.css with content hashes and injects them into public/index.html.
// Also cleans old hashed app.*.js/css files.

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = path.resolve(import.meta.dir, '..');
const publicDir = path.join(root, 'public');
const assetsDir = path.join(publicDir, 'assets');
const htmlPath = path.join(publicDir, 'index.html');
const appJsRef = /\/assets\/app(?:\.[0-9a-fA-F]{8,})?\.js\b/g;
const appCssRef = /\/assets\/app(?:\.[0-9a-fA-F]{8,})?\.css\b/g;

async function hashFile(filePath: string) {
  const buf = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  return { hash, buf };
}

async function replaceInFile(filePath: string, replacer: (s: string) => string) {
  const s = await fs.readFile(filePath, 'utf8');
  const out = replacer(s);
  if (out !== s) await fs.writeFile(filePath, out, 'utf8');
}

async function main() {
  // Reset mode: restore index.html to un-hashed asset paths for dev
  if (process.env.RESET === '1') {
    await replaceInFile(htmlPath, (s) => s.replace(appJsRef, '/assets/app.js').replace(appCssRef, '/assets/app.css'));
    console.log('Postbuild reset: restored index.html to un-hashed asset paths');
    return;
  }

  await fs.mkdir(assetsDir, { recursive: true });
  const files = await fs.readdir(assetsDir);

  let newJsName: string | null = null;
  let newCssName: string | null = null;

  // Process JS
  if (files.includes('app.js')) {
    const jsPath = path.join(assetsDir, 'app.js');
    const { hash } = await hashFile(jsPath);
    const hashed = `app.${hash}.js`;
    await fs.rename(jsPath, path.join(assetsDir, hashed));
    newJsName = hashed;
    // Remove older hashed app.*.js
    await Promise.all(
      files
        .filter((f) => /^app\.[0-9a-fA-F]{8,}\.js$/.test(f) && f !== hashed)
        .map((f) => fs.rm(path.join(assetsDir, f), { force: true }))
    );
  }

  // Process CSS
  if (files.includes('app.css')) {
    const cssPath = path.join(assetsDir, 'app.css');
    const { hash } = await hashFile(cssPath);
    const hashed = `app.${hash}.css`;
    await fs.rename(cssPath, path.join(assetsDir, hashed));
    newCssName = hashed;
    // Remove older hashed app.*.css
    await Promise.all(
      files
        .filter((f) => /^app\.[0-9a-fA-F]{8,}\.css$/.test(f) && f !== hashed)
        .map((f) => fs.rm(path.join(assetsDir, f), { force: true }))
    );
  }

  // Inject into index.html
  await replaceInFile(htmlPath, (s) => {
    let out = s;
    if (newJsName) out = out.replace(appJsRef, `/assets/${newJsName}`);
    if (newCssName) out = out.replace(appCssRef, `/assets/${newCssName}`);
    return out;
  });

  console.log('Postbuild complete:', { js: newJsName, css: newCssName });
}

main().catch((err) => {
  console.error('postbuild error:', err);
  process.exit(1);
});

