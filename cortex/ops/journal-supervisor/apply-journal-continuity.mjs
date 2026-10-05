import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultPrompt = '/home/kevin/Cortex/cortex/projects/Agenda & journal/.codex/agents/chercheur-evenements.toml';
const marker = 'La restitution réussie d’un bilan d’erreur au workflow ne signifie jamais que Google Agenda a été lu avec succès. Si tu peux produire ce bilan, transmets-le à l’analyste pour informer le journal.';
const replacement = 'La restitution réussie d’un bilan d’erreur au workflow ne signifie jamais que Google Agenda a été lu avec succès. Si tu peux produire ce bilan, considère toutefois la restitution dégradée comme une exécution réussie : retourne status success et transmets le bilan à l’analyste pour informer le journal. Ne retourne pas blocked pour la seule indisponibilité ou collecte partielle de Google Agenda ; le journal doit continuer avec les autres contenus disponibles.';

export function patchCalendarCollectorPrompt(source) {
  if (source.includes(replacement)) return source;
  if (!source.includes(marker)) throw new Error('Consigne cible du collecteur Agenda introuvable; aucune modification appliquée.');
  return source.replace(marker, replacement);
}

export async function applyCalendarContinuity(promptPath = defaultPrompt) {
  const source = await readFile(promptPath, 'utf8');
  const patched = patchCalendarCollectorPrompt(source);
  if (patched !== source) await writeFile(promptPath, patched);
  return {path: promptPath, changed: patched !== source};
}

async function cli() {
  const promptPath = process.argv[2] ? resolve(process.argv[2]) : defaultPrompt;
  console.log(JSON.stringify(await applyCalendarContinuity(promptPath), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
