// Hands this entry in. Node 22, standard library only, no network: the program copies app/
// and screenshots/ from this repository to /output and writes /output/dossier.json with
// buildDossier from vendor/makefun-frontend.ts — the kit's own library, left byte for byte
// as it was handed out, because the scorer builds the dossier again from the same files and
// requires the two to be identical.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts     (outside the grader /output stands in for it)
//   node serve.ts                           (to open the frontend in a browser)
//
// Two runs must write the same bytes: everything written here is a function of the files in
// this repository alone — no timestamps, no ordering that a directory walk decides, no host
// paths carried into the dossier — so a rebuild in the same container is byte for byte equal.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The scorer's own caps (reference/gate.json): what buildDossier refuses is what the gate refuses. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

/** A piece of the entry that is missing is refused here rather than half-written to /output. */
const REQUIRED = ['app/index.html', 'app/js/app.js', 'screenshots', 'vendor/makefun-frontend.ts'];

for (const piece of REQUIRED) {
  if (!existsSync(join(here, piece))) throw new Error(`the repository has no ${piece}: this is not the entry`);
}

mkdirSync(output, { recursive: true });
cpSync(join(here, 'app'), join(output, 'app'), { recursive: true });
mkdirSync(join(output, 'screenshots'), { recursive: true });
cpSync(join(here, 'screenshots'), join(output, 'screenshots'), { recursive: true });

const dossier = buildDossier(output, CAPS);
writeFileSync(join(output, 'dossier.json'), dossier);

/** What was handed in, counted the way the scorer counts it. */
function walk(dir: string, files: number[] = []): number[] {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, files);
    else files.push(stats.size);
  }
  return files;
}

const appFiles = walk(join(output, 'app'));
const shots = readdirSync(join(output, 'screenshots')).filter((name) => !name.startsWith('.')).sort();
console.log(`output      ${output}`);
console.log(`app/        ${appFiles.length} files, ${(appFiles.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB raw`);
console.log(`screenshots ${shots.length}: ${shots.join(', ')}`);
console.log(`dossier.json ${Buffer.byteLength(dossier)} bytes`);
