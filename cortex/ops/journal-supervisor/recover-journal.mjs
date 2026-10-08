import {readFile, copyFile, mkdir, rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults, checkPublication, parisDate, saveReport} from './check-journal.mjs';

function runRenderer(node, args, cwd, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(node, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
    let diagnostics = '';
    child.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun(diagnostics) : reject(new Error(`Rendu en échec (${code}) : ${diagnostics}`)));
  });
}

export async function recoverJournal(configuration = {}, {
  now = new Date(), check = checkPublication, render = runRenderer, loadRuns
} = {}) {
  const config = {...defaults, ...configuration};
  const before = await check(config, {now});
  if (before.published) return {status: 'already_published', before};
  const editionDate = parisDate(now);
  const inputPath = resolve(config.journalProject, '.cortex/journal/editions', `${editionDate}.json`);
  let edition;
  try { edition = JSON.parse(await readFile(inputPath, 'utf8')); }
  catch (error) { return {status: 'needs_repair', reason: `Données d’édition absentes ou illisibles : ${error.code || error.message}`, before}; }
  if (edition.editionDate !== editionDate) return {status: 'needs_repair', reason: 'La date des données ne correspond pas à aujourd’hui.', before};
  let runs;
  if (loadRuns) runs = await loadRuns();
  else {
    const require = createRequire(resolve(config.cortexRoot, 'package.json'));
    const Database = require('better-sqlite3');
    const db = new Database(resolve(config.cortexRoot, 'data/audit/cortex-audit.sqlite'), {readonly: true, fileMustExist: true});
    try {
      runs = db.prepare(`SELECT id, status, started_at FROM workflow_runs
        WHERE project_id = ? AND scope = 'workflow' ORDER BY started_at DESC LIMIT 30`).all(config.journalProjectId);
    } finally { db.close(); }
  }
  const run = runs.find(candidate => parisDate(new Date(candidate.started_at)) === editionDate);
  if (run?.status === 'running') return {status: 'production_running', runId: run.id, before};
  if (!run) return {status: 'needs_repair', reason: 'Aucune production du journal pour la date du jour dans l’audit.', before};
  const stateDirectory = resolve(config.stateDirectory || '.cortex/journal-watch');
  const backupDirectory = resolve(stateDirectory, 'backups', now.toISOString().replace(/[:.]/g, '-'));
  await mkdir(backupDirectory, {recursive: true});
  await copyFile(inputPath, resolve(backupDirectory, `${editionDate}.json`));
  if (before.local.exists) await copyFile(before.local.path, resolve(backupDirectory, `${editionDate}.html`));
  const stagingPath = resolve(backupDirectory, `${editionDate}.recovered.html`);
  const diagnostics = await render(process.execPath, [resolve(config.journalProject, '.cortex/journal/render-journal.mjs'),
    '--input', inputPath, '--output', stagingPath], config.journalProject,
    {...process.env, CORTEX_JOURNAL_RUN_ID: run.id});
  const target = resolve(config.webRoot, `${editionDate}.html`);
  await mkdir(dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.recovery.tmp`;
  await copyFile(stagingPath, temporary);
  await rename(temporary, target);
  const after = await check(config, {now: new Date()});
  return {status: after.published ? 'recovered' : 'needs_repair', runId: run.id, before, after, backupDirectory, diagnostics};
}

async function cli() {
  if (process.argv.length > 2) throw new Error('Usage : node recover-journal.mjs');
  const report = await recoverJournal();
  await saveReport(resolve('.cortex/journal-watch/last-recovery.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (!['already_published', 'recovered'].includes(report.status)) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
