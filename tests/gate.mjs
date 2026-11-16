// The gate's own rows, run here: this reads the built /output the way the sealed scorer does,
// with the kit's library (vendor/makefun-frontend.ts), and prints what the scorer would print.
// It is not the scorer — only the server's copy is sealed — but it is the same library and the
// same caps, so it catches what the scorer would refuse before a submission does.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts      # build /output first
//   node tests/gate.mjs                      # then check it (reads out/ by default)

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier, firstLoadOf, htmlFacts, readAppTree } from '../vendor/makefun-frontend.ts';

const out = process.argv[2] ?? process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
  app_path_max_bytes: 1000,
};

let passed = 0;
const failures = [];
const ok = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL ${label} ${detail}`);
  }
};

if (!existsSync(out)) {
  console.error(`no ${out}/: build it first with MAKEFUN_OUTPUT_DIR=${out} node main.ts`);
  process.exit(2);
}

// ---- app_files -------------------------------------------------------------------------------
const tree = readAppTree(join(out, 'app'), CAPS);
const index = join(out, 'app', 'index.html');
ok('app_files: app/ is within the file and byte caps', tree.count <= CAPS.app_max_files && tree.totalBytes <= CAPS.app_max_bytes, `${tree.count} entries, ${tree.totalBytes} bytes`);
ok('app_files: every path is within 1000 UTF-8 bytes', tree.files.every((file) => Buffer.byteLength(file.path, 'utf8') <= CAPS.app_path_max_bytes), `longest ${Math.max(...tree.files.map((f) => Buffer.byteLength(f.path, 'utf8')))}`);
ok('app_files: index.html is a regular file of at most 1 MiB', statSync(index).isFile() && statSync(index).size <= 1048576, `${statSync(index).size} bytes`);
ok('app_files: no symbolic link or special file under app/', readdirSync(join(out, 'app'), { recursive: true, withFileTypes: true }).every((entry) => entry.isDirectory() || entry.isFile()));

// ---- references ------------------------------------------------------------------------------
const facts = htmlFacts(readFileSync(index, 'utf8'));
const textOf = (path) => readFileSync(join(out, 'app', path), 'utf8');
const load = firstLoadOf(tree, facts, textOf);
ok('references: every first-load reference names a file of app/', load.missing.length === 0, load.missing.map((m) => `${m.ref} (${m.where})`).join('; '));
ok('references: every import() reference names a file of app/', load.laterMissing.length === 0, load.laterMissing.map((m) => `${m.ref} (${m.where})`).join('; '));
ok('references: no import() of a computed specifier', load.computed.length === 0, load.computed.join(', '));
ok('references: nothing armed from a data: URL but a font', !/[\s"'(]data:/i.test(readFileSync(index, 'utf8')));

// ---- screenshots -----------------------------------------------------------------------------
function jpegSize(file) {
  const bytes = readFileSync(file);
  for (let i = 2; i < bytes.length - 9; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

const shotDir = join(out, 'screenshots');
const shots = readdirSync(shotDir).filter((name) => !name.startsWith('.')).sort();
ok('screenshots: three of them', shots.length === CAPS.screenshots.max, shots.join(', '));
ok('screenshots: names are letters, digits, . _ -', shots.every((name) => /^[A-Za-z0-9._-]{1,128}$/.test(name) && !name.startsWith('.') && !name.startsWith('-')));
for (const name of shots) {
  const file = join(shotDir, name);
  const bytes = statSync(file).size;
  const size = name.endsWith('.jpg') || name.endsWith('.jpeg') ? jpegSize(file) : null;
  ok(`screenshots: ${name} is within 256 KiB`, bytes <= CAPS.screenshots.max_bytes, `${bytes} bytes`);
  ok(`screenshots: ${name} is 1280 long and 800 short`, Boolean(size) && Math.max(size.width, size.height) <= 1280 && Math.min(size.width, size.height) >= 360, size ? `${size.width}x${size.height}` : 'not a JPEG this reader knows');
}

// ---- dossier_matches -------------------------------------------------------------------------
const onDisk = readFileSync(join(out, 'dossier.json'));
const rebuilt = buildDossier(out, CAPS);
ok('dossier_matches: dossier.json is what buildDossier writes', Buffer.compare(onDisk, Buffer.from(rebuilt)) === 0, `${onDisk.length} bytes`);
ok('dossier_matches: at most 1.5 MiB', onDisk.length <= 1572864, `${onDisk.length} bytes`);
ok('output: within the platform cap of 1000 entries and 64 MiB', readdirSync(out, { recursive: true }).length <= 1000);

// ---- what the judge reads --------------------------------------------------------------------
const dossierText = JSON.parse(onDisk.toString('utf8')).text;
const totals = dossierText.split('\n').find((line) => line.startsWith('Totals:'));
console.log(`\n${totals}\n`);
console.log(`first load, in the page's order:`);
for (const path of load.paths) console.log(`  app/${path}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  failed: ${failure}`);
  process.exit(1);
}
