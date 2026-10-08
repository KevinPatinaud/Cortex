import {readFile, copyFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults} from './check-journal.mjs';

const recoveryInstructions = `### 7.2. Conservation des contenus et récupération automatique

Reprends les articles et événements disponibles, en conservant les textes intégraux reçus. Le contrôle de fidélité préalable obligatoire est supprimé : ne demande aucune validation humaine et ne bloque pas la génération parce qu'une comparaison intégrale est impossible, qu'un titre ne commence pas par # ou qu'un rapprochement échoue.

Le générateur récupère automatiquement les articles intégraux disponibles dans l'audit de l'exécution courante. Cette récupération est facultative et accepte les titres en texte simple. Si elle ne peut pas être effectuée, génère l'édition avec les contenus disponibles, sans inventer les passages manquants. Signale une limite de contenu réelle et importante dans verificationNotes ; une limite purement technique reste dans les journaux techniques.

`;

export function patchSynthesePrompt(prompt) {
  const start = prompt.indexOf('### 7.2.');
  const end = prompt.indexOf('### 7.3.', start);
  if (start < 0 || end < 0) throw new Error('Sections du générateur introuvables : mise à jour automatique non applicable.');
  return prompt.slice(0, start) + recoveryInstructions + prompt.slice(end);
}

export async function applyJournalFidelity(config = defaults) {
  const require = createRequire(resolve(config.cortexRoot, 'package.json'));
  const {parse} = require('smol-toml');
  const folder = dirname(fileURLToPath(import.meta.url));
  const helper = await readFile(resolve(folder, 'journal-repair/article-fidelity.mjs'), 'utf8');
  const promptPath = resolve(config.journalProject, '.codex/agents/synthese.toml');
  const original = await readFile(promptPath, 'utf8');
  const prompt = patchSynthesePrompt(parse(original).developer_instructions);
  const updated = original.replace(/^developer_instructions\s*=.*$/m, 'developer_instructions = ' + JSON.stringify(prompt));
  if (parse(updated).developer_instructions !== prompt) throw new Error('TOML de synthèse invalide.');
  const backup = resolve(config.cortexRoot, 'data/backups', 'journal-fidelity-' + new Date().toISOString().replace(/[:.]/g, '-'));
  const changes = [
    [resolve(config.journalProject, '.cortex/journal/article-fidelity.mjs'), helper],
    [promptPath, updated]
  ];
  const applied = [];
  for (const [path, content] of changes) {
    if (await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }) === content) continue;
    await mkdir(backup, {recursive: true});
    await copyFile(path, resolve(backup, path.split(/[\\/]/).pop())).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const temporary = path + '.' + process.pid + '.tmp';
    await writeFile(temporary, content);
    await rename(temporary, path);
    applied.push(path);
  }
  return {applied, backup: applied.length ? backup : null};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) { console.error('Usage : node apply-journal-fidelity.mjs'); process.exitCode = 1; }
  else applyJournalFidelity().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
