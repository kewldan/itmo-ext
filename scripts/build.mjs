import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const checkOnly = process.argv.includes('--check');
const errors = [];

const read = (p) => readFileSync(join(root, p));

function listFiles(dir) {
  const entries = readdirSync(join(root, dir), { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .flatMap((e) =>
      e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
    );
}

function requireFile(path, from) {
  if (!existsSync(join(root, path))) errors.push(`${from}: нет файла ${path}`);
}

function pngSize(path) {
  const buf = read(path);
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const manifest = JSON.parse(read('manifest.json'));

if (manifest.manifest_version !== 3) errors.push('manifest_version должен быть 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
  errors.push(`некорректная версия: ${manifest.version}`);
}

const icons = { ...manifest.icons, ...manifest.action?.default_icon };
for (const [size, path] of Object.entries(icons)) {
  requireFile(path, 'icons');
  if (!existsSync(join(root, path))) continue;
  const dims = pngSize(path);
  if (!dims || dims[0] !== Number(size) || dims[1] !== Number(size)) {
    errors.push(`${path}: ожидается PNG ${size}×${size}, а не ${dims?.join('×') ?? '?'}`);
  }
}

requireFile(manifest.background.service_worker, 'background');
for (const cs of manifest.content_scripts ?? []) {
  for (const path of cs.js ?? []) requireFile(path, 'content_scripts');
}
const popup = manifest.action?.default_popup;
if (popup) {
  requireFile(popup, 'action');
  const html = read(popup).toString();
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    requireFile(join(popup, '..', ref), popup);
  }
}

const sources = ['src', 'popup', 'scripts']
  .flatMap(listFiles)
  .filter((p) => ['.js', '.mjs'].includes(extname(p)));
for (const path of sources) {
  try {
    execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' });
  } catch (err) {
    const lines = err.stderr.toString().replaceAll(root, '').split('\n');
    const reason = lines.find((l) => /Error/.test(l)) ?? lines[0];
    errors.push(`${lines[0].trim()}: ${reason.trim()}`);
  }
}

const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
if (tag && tag.replace(/^v/, '') !== manifest.version) {
  errors.push(`тег ${tag} не совпадает с версией в manifest.json (${manifest.version})`);
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ manifest ${manifest.version}, ${sources.length} скриптов, ${Object.keys(icons).length} иконок`);

if (checkOnly) process.exit(0);

const dist = join(root, 'dist');
const zip = join(dist, `itmo-ext-${manifest.version}.zip`);
mkdirSync(dist, { recursive: true });
rmSync(zip, { force: true });
const files = ['manifest.json', 'LICENSE', ...['src', 'popup', 'icons'].flatMap(listFiles)].sort();
execFileSync('zip', ['-X', '-q', zip, ...files], { cwd: root, stdio: 'inherit' });
console.log(`✓ ${zip.replace(root, '')} (${files.length} файлов)`);
