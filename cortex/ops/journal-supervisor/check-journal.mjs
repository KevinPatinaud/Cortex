import {readFile, mkdir, rename, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const defaults = {
  cortexRoot: '/home/kevin/Cortex/cortex',
  journalProject: '/home/kevin/Cortex/cortex/projects/Agenda & journal',
  journalProjectId: 'e338b35b-0a2a-47c7-9fef-d101bcc1edd2',
  webRoot: '/var/www/KevinPatinaud/journal',
  publicBaseUrl: 'https://kevinpatinaud.fr/journal/',
  timeoutMs: 20000
};

export function parisDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}

export function inspectEditionHTML(html, editionDate) {
  const footer = /<footer\b[^>]*class=["'][^"']*\bpage-footer\b[^"']*["'][^>]*>([\s\S]*?)<\/footer>/i.exec(html)?.[1] || '';
  const editionMatches = new RegExp(`<time\\b[^>]*datetime=["']${editionDate}["']`, 'i').test(footer);
  const document = /<!doctype\s+html>/i.test(html) && /<main\b/i.test(html) && /<\/html\s*>/i.test(html);
  return {valid: document && editionMatches, editionMatches, document, bytes: Buffer.byteLength(html)};
}

export async function checkPublication(configuration = {}, {now = new Date(), fetchImpl = fetch} = {}) {
  const config = {...defaults, ...configuration};
  const editionDate = parisDate(now);
  const url = new URL(`${editionDate}.html`, config.publicBaseUrl).href;
  const localPath = resolve(config.webRoot, `${editionDate}.html`);
  let local;
  try { local = {...inspectEditionHTML(await readFile(localPath, 'utf8'), editionDate), path: localPath, exists: true}; }
  catch (error) { local = {path: localPath, exists: false, error: error.code || error.message}; }
  let publicPage;
  try {
    const response = await fetchImpl(url, {headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(config.timeoutMs)});
    const html = await response.text();
    publicPage = {status: response.status, ...inspectEditionHTML(html, editionDate)};
  } catch (error) { publicPage = {status: null, valid: false, error: error.message}; }
  const published = publicPage.status === 200 && publicPage.valid;
  return {editionDate, checkedAt: now.toISOString(), timezone: 'Europe/Paris', url, published, local, publicPage};
}

export async function saveReport(path, report) {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, path);
}

async function cli() {
  const args = process.argv.slice(2);
  let output;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage : node check-journal.mjs [--output rapport.json]');
    output = resolve(args[1]);
  }
  const report = await checkPublication();
  if (output) await saveReport(output, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.published) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
