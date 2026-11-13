import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function buildHtml() {
  const paths = ['lib/model.js', 'lib/scheduler.js', 'lib/portable.js', 'public/app.js'];
  const [template, styles, ...scripts] = await Promise.all(['public/index.html', 'public/styles.css', ...paths].map((path) => readFile(resolve(root, path), 'utf8')));
  const code = scripts.map((source) => source.replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '')).join('\n\n');
  const wrapped = `(async () => {\n'use strict';\n${code}\n})().catch((error) => { document.getElementById('app').textContent = 'Unable to open this event: ' + error.message; });`;
  return template.replace('/* APP_STYLES */', () => styles.replace(/<\/style/gi, '<\\/style')).replace('/* APP_CODE */', () => wrapped.replace(/<\/script/gi, '<\\/script'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(resolve(root, 'index.html'), await buildHtml(), 'utf8');
  console.log('Built index.html. Open it directly in a browser; no server is needed.');
}
