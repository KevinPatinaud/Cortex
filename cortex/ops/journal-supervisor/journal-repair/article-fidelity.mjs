import {access} from 'node:fs/promises';

const AUDIT_DB = '/home/kevin/Cortex/cortex/data/audit/cortex-audit.sqlite';
const PROJECT_ID = 'e338b35b-0a2a-47c7-9fef-d101bcc1edd2';
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Recover available complete articles; reconciliation is never a publication gate. */
export function restoreAvailableWriterArticles(edition, rows) {
  const warnings = [];
  if (!Array.isArray(edition.articles)) return {edition, changed: false, warnings};
  const writers = [];
  const seen = new Set();
  for (const {response} of rows) {
    let items;
    try { items = JSON.parse(response).items; }
    catch { warnings.push('Réponse Rédacteur illisible : données de synthèse conservées.'); continue; }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const content = item?.content;
      if (typeof content !== 'string' || !content.trim() || seen.has(content)) continue;
      const firstLine = content.replace(/^\uFEFF/, '').trimStart().split(/\r?\n/, 1)[0].trim();
      const title = (firstLine.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '')
        .replace(/^\*\*(.+)\*\*$/, '$1')).trim();
      if (!title || title.length > 300) {
        warnings.push('Titre Rédacteur non identifiable : données de synthèse conservées.');
        continue;
      }
      seen.add(content);
      writers.push({title, markdown: content});
    }
  }
  if (!writers.length) return {edition, changed: false, warnings};
  const unused = new Set(writers.map((_, index) => index));
  const restored = edition.articles.map(article => {
    if (typeof article?.title !== 'string') return article;
    const key = normalize(article.title);
    let matches = [...unused].filter(index => normalize(writers[index].title) === key);
    if (!matches.length && key.length >= 30) {
      matches = [...unused].filter(index => normalize(writers[index].title).startsWith(key.slice(0, 30)));
    }
    if (matches.length !== 1) {
      warnings.push(`Rapprochement facultatif ignoré pour « ${article.title} ».`);
      return article;
    }
    const index = matches[0];
    unused.delete(index);
    return {...article, title: writers[index].title, markdown: writers[index].markdown};
  });
  for (const index of unused) {
    if (!restored.some(article => article?.markdown === writers[index].markdown)) restored.push({...writers[index]});
  }
  const changed = JSON.stringify(restored) !== JSON.stringify(edition.articles);
  return {edition: changed ? {...edition, articles: restored} : edition, changed, warnings};
}

export async function restoreWriterArticles(edition) {
  const unchanged = {edition, changed: false, warnings: []};
  if (process.platform !== 'linux') return unchanged;
  let db;
  try {
    await access(AUDIT_DB);
    const {default: Database} = await import('better-sqlite3');
    db = new Database(AUDIT_DB, {readonly: true, fileMustExist: true});
    const runId = process.env.CORTEX_JOURNAL_RUN_ID || db.prepare(`
      SELECT id FROM workflow_runs WHERE project_id = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `).get(PROJECT_ID)?.id;
    if (!runId) return unchanged;
    const run = db.prepare('SELECT project_id FROM workflow_runs WHERE id = ?').get(runId);
    if (run?.project_id !== PROJECT_ID) {
      return {...unchanged, warnings: ['Rapprochement ignoré : le run appartient à un autre projet.']};
    }
    const rows = db.prepare(`
      SELECT response FROM agent_executions
      WHERE run_id = ? AND agent_name = 'Rédacteur journalistique' AND status = 'succeeded'
      ORDER BY started_at, id
    `).all(runId);
    return restoreAvailableWriterArticles(edition, rows);
  } catch (error) {
    if (error.code === 'ENOENT') return unchanged;
    return {...unchanged, warnings: [`Rapprochement facultatif indisponible : ${error.message}`]};
  } finally {
    try { db?.close(); } catch { /* Optional recovery must not block the renderer. */ }
  }
}
