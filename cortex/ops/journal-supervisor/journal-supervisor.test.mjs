import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkPublication, inspectEditionHTML, parisDate} from './check-journal.mjs';
import {recoverJournal} from './recover-journal.mjs';
import {patchSynthesePrompt} from './apply-journal-fidelity.mjs';
import {restoreAvailableWriterArticles} from './journal-repair/article-fidelity.mjs';

const now = new Date('2026-10-01T06:30:00Z');
const html = date => `<!DOCTYPE html><html lang="fr"><body><main>Journal</main><footer class="page page-footer"><time datetime="${date}">Edition</time></footer></body></html>`;
const response = (status, body) => async () => ({status, text: async () => body});

test('publication du jour, date ancienne dans une réponse 200, page vide, erreur HTTP et panne réseau', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journal-check-'));
  await writeFile(join(root, '2026-10-01.html'), html('2026-10-01'));
  const config = {webRoot: root};
  const published = await checkPublication(config, {now, fetchImpl: response(200, html('2026-10-01'))});
  assert.equal(published.published, true);
  assert.equal(published.local.valid, true);
  for (const [status, body] of [[200, html('2026-09-30')], [200, ''], [503, html('2026-10-01')]]) {
    assert.equal((await checkPublication(config, {now, fetchImpl: response(status, body)})).published, false);
  }
  const failed = await checkPublication(config, {now, fetchImpl: async () => { throw new Error('network unavailable'); }});
  assert.equal(failed.published, false);
  assert.equal(failed.publicPage.status, null);
});

test('la date est celle de Paris, en été et en hiver, même près de minuit UTC', () => {
  assert.equal(parisDate(new Date('2026-09-30T22:30:00Z')), '2026-10-01');
  assert.equal(parisDate(new Date('2026-12-01T23:30:00Z')), '2026-12-02');
  assert.equal(parisDate(new Date('2026-10-25T00:30:00Z')), '2026-10-25');
});

test('un rendez-vous du jour ne transforme pas un journal ancien en édition du jour', () => {
  const stale = html('2026-09-30').replace('<main>', '<main><time datetime="2026-10-01">Agenda</time>');
  assert.equal(inspectEditionHTML(stale, '2026-10-01').valid, false);
});

test('aucune réparation ni lecture de données si le journal est déjà publié', async () => {
  const result = await recoverJournal({}, {
    now, check: async () => ({published: true}),
    loadRuns: () => { throw new Error('must not read audit'); },
    render: () => { throw new Error('must not render'); }
  });
  assert.equal(result.status, 'already_published');
});

async function fixture(date = '2026-10-01') {
  const root = await mkdtemp(join(tmpdir(), 'journal-recovery-'));
  const project = join(root, 'Agenda & journal');
  await mkdir(join(project, '.cortex/journal/editions'), {recursive: true});
  await writeFile(join(project, '.cortex/journal/editions/2026-10-01.json'), JSON.stringify({editionDate: date, articles: []}));
  return {cortexRoot: root, journalProject: project, webRoot: join(root, 'web'), stateDirectory: join(root, 'state')};
}

test('une production en cours ne déclenche pas de second rendu', async () => {
  const config = await fixture();
  const result = await recoverJournal(config, {
    now, check: async () => ({published: false, local: {exists: false}}),
    loadRuns: async () => [{id: 'in-progress', status: 'running', started_at: now.toISOString()}],
    render: () => { throw new Error('must not render'); }
  });
  assert.equal(result.status, 'production_running');
});

test('une édition ancienne n’est jamais publiée sous la date du jour', async () => {
  const config = await fixture('2026-09-30');
  const result = await recoverJournal(config, {
    now, check: async () => ({published: false}), render: () => { throw new Error('must not render'); }
  });
  assert.equal(result.status, 'needs_repair');
  assert.match(result.reason, /date/);
});

test('récupération sauvegardée, liée au run du jour et confirmée après publication', async () => {
  const config = await fixture();
  let checks = 0;
  const result = await recoverJournal(config, {
    now, check: async () => ({published: ++checks > 1, local: {exists: false}}),
    loadRuns: async () => [{id: 'today-run', status: 'failed', started_at: now.toISOString()}],
    render: async (_node, args, _cwd, env) => {
      assert.equal(env.CORTEX_JOURNAL_RUN_ID, 'today-run');
      await writeFile(args[args.indexOf('--output') + 1], html('2026-10-01'));
      return 'rendered';
    }
  });
  assert.equal(result.status, 'recovered');
  assert.equal(await readFile(join(config.webRoot, '2026-10-01.html'), 'utf8'), html('2026-10-01'));
  assert.equal(JSON.parse(await readFile(join(result.backupDirectory, '2026-10-01.json'), 'utf8')).editionDate, '2026-10-01');
});

test('le correctif supprime le contrôle obligatoire et accepte les titres sans marqueur Markdown', () => {
  const prompt = patchSynthesePrompt('Avant\n### 7.2. Contrôle de fidélité obligatoire\nBloquer\n### 7.3. Produire le fichier\nAprès');
  assert.equal(prompt.includes('### 7.2. Contrôle de fidélité obligatoire'), false);
  assert.match(prompt, /Le contrôle de fidélité préalable obligatoire est supprimé/);
  assert.match(prompt, /Après$/);
  const result = restoreAvailableWriterArticles({articles: [{title: 'Article du jour', markdown: 'Résumé'}]}, [
    {response: JSON.stringify({items: [{content: 'Article du jour\n\nTexte complet et sources.'}]})}
  ]);
  assert.equal(result.edition.articles[0].markdown, 'Article du jour\n\nTexte complet et sources.');
  assert.equal(result.warnings.length, 0);
  const absent = restoreAvailableWriterArticles({articles: []}, [{response: 'invalid JSON'}]);
  assert.equal(absent.changed, false);
  assert.equal(absent.warnings.length, 1);
});
