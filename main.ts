// Entry program for the threejs-fps-02 bounty (Node 22, standard library only).
//
// This is the hand-in step: it gathers the playable game in game/, the cover
// and action shots in screenshots/, and the dossier.json the judge reads,
// and writes them all under one output directory. The grader runs it with
// /output as the target; locally, point MAKEFUN_OUTPUT_DIR at a scratch
// folder instead:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   node serve.ts   # play the game at http://localhost:8080

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Directory holding this file; every source path below is resolved from it.
const repoRoot = fileURLToPath(new URL('./', import.meta.url));
const targetDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps from reference/gate.json. Only text_max_bytes shapes the
// dossier bytes; the rest mirror what the scorer refuses: at most 4
// screenshots, none over 256 KiB; game/ at most 993 entries or 48 MiB in
// total, sharing /output's own 1000-entry cap with screenshots/ and the
// dossier file itself.
const dossierLimits = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function makeDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyTree(source: string, destination: string): void {
  fs.cpSync(source, destination, { recursive: true });
}

// Copy a folder beside main.ts into the output dir, but only when it exists.
function copyFolderWhenPresent(folderName: string): void {
  const source = path.join(repoRoot, folderName);
  if (!fs.existsSync(source)) return;
  copyTree(source, path.join(targetDir, folderName));
}

function assembleBundle(): void {
  makeDir(targetDir);
  copyTree(path.join(repoRoot, 'game'), path.join(targetDir, 'game'));
  makeDir(path.join(targetDir, 'screenshots'));
  copyFolderWhenPresent('screenshots');

  const dossier = buildDossier(targetDir, dossierLimits);
  fs.writeFileSync(path.join(targetDir, 'dossier.json'), dossier);
}

assembleBundle();
