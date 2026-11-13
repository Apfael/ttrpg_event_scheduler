import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SharedPlanner } from '../lib/shared.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'runtime/manifest.json'), 'utf8'));
test('PHP and its app-local Windows dependency are bundled with checksums and notices', async () => {
  const archive = await readFile(resolve(root, 'runtime', manifest.archive));
  assert.equal(createHash('sha256').update(archive).digest('hex'), manifest.archiveSha256);
  for (const name of ['php.exe', 'php8.dll', 'vcruntime140.dll', 'license.txt', 'readme-redist-bins.txt', 'THIRD-PARTY-NOTICES.md']) assert.ok(manifest.files.some((f) => f.path === name), name);
  assert.equal(manifest.upstreamSha256, 'dbae154a0a89791f36c3d48e68bae797878333e7d6cb5721e74617de59b63ab7');
});
test('Windows launcher starts from a moved synced folder, reuses its server, saves data beside the app, and stops safely', { skip: process.platform !== 'win32', timeout: 120000 }, async (t) => {
  const testRoot = resolve(root, 'test-results'); await mkdir(testRoot, { recursive: true });
  const temporary = await mkdtemp(resolve(testRoot, 'launcher-'));
  const app = resolve(temporary, "cloud sync & café 'event' !"); await mkdir(app);
  const powershell = resolve(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const launcher = resolve(app, 'portable/launcher.ps1');
  for (const name of ['portable', 'runtime', 'api.php', 'index.html', 'organizer.html', 'players.html', 'README.md', 'Start Tabletop.cmd', 'Start Tabletop LAN.cmd', 'Stop Tabletop.cmd']) await cp(resolve(root, name), resolve(app, name), { recursive: true });
  // Neither global PHP nor Node is available to the launcher. Windows system tools remain.
  const environment = { ...process.env, PATH: `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`, TABLETOP_NO_PAUSE: '1' };
  async function launch(action, ...options) {
    const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Action', action, '-NoBrowser', '-Json', ...options], { cwd: temporary, env: environment, windowsHide: true, timeout: 30000 });
    return JSON.parse(result.stdout.trim());
  }
  let diagnosticPath;
  t.after(async () => {
    if (diagnosticPath) { try { const log = await readFile(diagnosticPath, 'utf8'); if (log.includes('Warning') || log.includes('Fatal')) t.diagnostic(log.slice(-2500)); } catch {} }
    try { await launch('Stop'); } catch {}
    assert.ok(resolve(temporary).startsWith(testRoot + sep));
    await rm(temporary, { recursive: true, force: true });
  });
  const started = await launch('Start'); assert.equal(started.Running, true);
  diagnosticPath = resolve(dirname(dirname(started.Executable)), 'server.stderr.log');
  assert.match(started.OrganizerUrl, /^http:\/\/127\.0\.0\.1:\d+\/organizer\.html$/);
  assert.ok(started.Executable.startsWith(resolve(app, '.tabletop-local') + sep));
  assert.equal((await launch('Start')).ProcessId, started.ProcessId, 'second launch reuses the same process');
  assert.equal((await launch('Status')).ProcessId, started.ProcessId);
  await assert.rejects(launch('Start', '-Lan'), /different network mode/, 'switching mode must not silently widen access or restart the app');
  const loaded = await execute(powershell, ['-NoLogo', '-NoProfile', '-Command', `[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); (Get-Process -Id ${Number(started.ProcessId)}).Modules | Where-Object { $_.ModuleName -ieq 'vcruntime140.dll' } | ForEach-Object { $_.FileName }`], { env: environment, windowsHide: true });
  assert.equal(loaded.stdout.trim().toLowerCase(), resolve(dirname(started.Executable), 'vcruntime140.dll').toLowerCase(), 'PHP loads the bundled VC runtime, not an installed system copy');
  for (const file of manifest.files) {
    const data = await readFile(resolve(dirname(started.Executable), file.path));
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
  }
  const base = new URL('.', started.OrganizerUrl).href;
  assert.equal((await fetch(base + 'players.html')).status, 200);
  const health = await (await fetch(base + '__tabletop/health')).json();
  assert.equal(health.instance, started.Instance); assert.equal(health.phpVersion, manifest.phpVersion);
  for (const path of ['runtime/manifest.json', '.git/config', 'portable/launcher.ps1', '.tabletop-local/anything', 'Start%20Tabletop.cmd', 'event-data.php', 'event-lock.php']) assert.equal((await fetch(base + path)).status, 404, path);
  let cookie = '';
  const client = new SharedPlanner(base + 'api.php', async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
    const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0]; return response;
  });
  await client.request('/api/setup', { password: 'Portable-test-password-123' });
  let state = await client.request('/api/admin');
  state = await client.request('/api/admin/event', { ...state.event, name: 'My portable event' });
  const data = await readFile(resolve(app, 'event-data.php'), 'utf8'); assert.ok(data.includes('My portable event'));
  assert.equal((await fetch(base + 'event-data.php')).status, 404);
  const machine = (await readdir(resolve(app, '.tabletop-local')))[0];
  const statePath = resolve(app, '.tabletop-local', machine, 'server.json');
  const original = await readFile(statePath, 'utf8');
  await writeFile(statePath, JSON.stringify({ ...JSON.parse(original), ProcessId: process.pid }));
  await assert.rejects(launch('Stop'), /another process|not stopped/, 'stale IDs must not stop an unrelated process');
  await writeFile(statePath, original);
  assert.equal((await launch('Stop')).Running, false);
  assert.equal((await launch('Status')).Running, false);
  assert.equal(await readFile(resolve(app, 'event-data.php'), 'utf8'), data);
  assert.equal((await launch('Stop')).Running, false, 'stop is safe to repeat');
  const restarted = await launch('Start'); assert.notEqual(restarted.ProcessId, started.ProcessId);
  assert.equal(restarted.Port, started.Port, 'restart keeps browser origin/edit credentials stable');
  const reopened = await (await fetch(new URL('api.php?action=event', restarted.OrganizerUrl))).json();
  assert.equal(reopened.event.name, 'My portable event');
  // The root .cmd entry point is tested too, including quotes/spaces/ampersands in its path.
  const wrapper = await execute(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${resolve(app, 'Start Tabletop.cmd')}" -NoBrowser -Json"`], { cwd: temporary, env: environment, windowsHide: true, windowsVerbatimArguments: true, timeout: 30000 });
  assert.equal(JSON.parse(wrapper.stdout.trim()).ProcessId, restarted.ProcessId);
});
