import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function buildHtml(entry = 'organizer') {
  const paths = ['lib/model.js', 'lib/scheduler.js', 'lib/shared.js', 'public/app.js'];
  const [template, styles, ...scripts] = await Promise.all(['public/index.html', 'public/styles.css', ...paths].map((path) => readFile(resolve(root, path), 'utf8')));
  const code = scripts.map((source) => source.replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '')).join('\n\n');
  const wrapped = `(async () => {\n'use strict';\n${code}\n})().catch((error) => { document.getElementById('app').textContent = 'Unable to open this event: ' + error.message; });`;
  const html = template.replace('/* APP_STYLES */', () => styles.replace(/<\/style/gi, '<\\/style')).replace('/* APP_CODE */', () => wrapped.replace(/<\/script/gi, '<\\/script'));
  return entry === 'players' ? html.replace('<script type="application/json" id="tabletop-data">null</script>', '<script type="application/json" id="tabletop-data">{"kind":"players"}</script>') : html;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const organizer = await buildHtml();
  await writeFile(resolve(root, 'index.html'), organizer, 'utf8');
  await writeFile(resolve(root, 'organizer.html'), organizer, 'utf8');
  await writeFile(resolve(root, 'players.html'), await buildHtml('players'), 'utf8');
  console.log('Built root HTML entry points. Upload them with api.php to the same PHP-enabled web folder.');
}
