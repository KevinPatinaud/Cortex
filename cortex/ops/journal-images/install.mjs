import {readFile, mkdir, rename, writeFile, unlink, lstat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {defaults} from '../journal-supervisor/check-journal.mjs';
import {patchRenderer, patchImagePrompt, patchWriterPrompt, illustratePublishedHTML} from './patch-renderer.mjs';
import {availableImageSources, hydrateNewsImages} from './journal-images.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const readOptional = path => readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), {recursive:true});
  const temporary = `${path}.${randomUUID()}.tmp`;
  const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing?.isSymbolicLink()) throw new Error('Destination liée symboliquement : ' + path);
  try {
    await writeFile(temporary,bytes,{flag:'wx',mode:existing ? existing.mode & 0o777 : 0o644});
    await rename(temporary,path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function installImages(configuration = {}, {editionDate} = {}) {
  const config = {...defaults,...configuration};
  const journal = resolve(config.journalProject,'.cortex/journal');
  const rendererPath = resolve(journal,'render-journal.mjs');
  const promptPath = resolve(config.journalProject,'.codex/agents/synthese.toml');
  const writerPath = resolve(config.journalProject,'.codex/agents/redacteur-journalistique.toml');
  const require = createRequire(resolve(config.cortexRoot,'package.json'));
  const {parse} = require('smol-toml');
  const [renderer, originalPrompt, originalWriter, module, importer] = await Promise.all([
    readFile(rendererPath,'utf8'), readFile(promptPath,'utf8'), readFile(writerPath,'utf8'), readFile(resolve(directory,'journal-images.mjs')),
    readFile(resolve(directory,'import-news-image.mjs'))
  ]);
  const updatedPrompt = patchImagePrompt(parse(originalPrompt).developer_instructions);
  const prompt = originalPrompt.replace(/^developer_instructions\s*=.*$/m, () => 'developer_instructions = ' + JSON.stringify(updatedPrompt));
  if (parse(prompt).developer_instructions !== updatedPrompt) throw new Error('Consignes TOML invalides.');
  const updatedWriter = patchWriterPrompt(parse(originalWriter).developer_instructions);
  const writer = originalWriter.replace(/^developer_instructions\s*=.*$/m, () => 'developer_instructions = ' + JSON.stringify(updatedWriter));
  if (parse(writer).developer_instructions !== updatedWriter) throw new Error('Consignes de rédaction TOML invalides.');
  const pending = [
    {path:resolve(journal,'journal-images.mjs'),label:'project/journal-images.mjs',bytes:module},
    {path:resolve(journal,'import-news-image.mjs'),label:'project/import-news-image.mjs',bytes:importer},
    {path:rendererPath,label:'project/render-journal.mjs',bytes:Buffer.from(patchRenderer(renderer))},
    {path:promptPath,label:'project/synthese.toml',bytes:Buffer.from(prompt)},
    {path:writerPath,label:'project/redacteur-journalistique.toml',bytes:Buffer.from(writer)}
  ];
  const readmePath = resolve(journal,'README.md');
  const readme = (await readOptional(readmePath))?.toString('utf8') || '';
  const readmeBlock = '\n<!-- BEGIN journal-images -->\n## Images réelles de l’actualité\n\nLe Rédacteur journalistique recherche une photographie ou un document publié en rapport avec chaque sujet, vérifie contexte, crédit et autorisation de republication, puis l’importe avec `import-news-image.mjs`. Le renderer rapproche les fiches datées des articles par titre et source, vérifie le fichier et ajoute une légende créditée. Aucun visuel généré ni repli décoratif. Une image absente ne bloque pas le journal. Voir `cortex/ops/journal-images/README.md` pour les métadonnées et les tests.\n<!-- END journal-images -->\n';
  const cleanedReadme = readme.replace('Les styles et commandes de lecture sont embarqués, sans CDN, police distante ni appel réseau à l’ouverture.', 'Les styles et commandes de lecture sont embarqués, sans CDN ni police distante. Les illustrations sont chargées depuis le site du journal ; les textes restent disponibles sans elles.');
  const readmePattern = /\n<!-- BEGIN journal-images -->[\s\S]*?<!-- END journal-images -->\n/;
  pending.push({path:readmePath,label:'project/README.md',bytes:Buffer.from(readmePattern.test(cleanedReadme) ? cleanedReadme.replace(readmePattern,()=>readmeBlock) : cleanedReadme + readmeBlock)});
  if (editionDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate) || new Date(`${editionDate}T12:00:00Z`).toISOString().slice(0,10) !== editionDate) throw new Error('Date d’édition invalide.');
    const htmlPath = resolve(config.webRoot,editionDate + '.html');
    const [html, source] = await Promise.all([readFile(htmlPath,'utf8'),readFile(resolve(journal,'editions',editionDate + '.json'),'utf8')]);
    const edition = await hydrateNewsImages(JSON.parse(source),journal);
    if (edition.editionDate !== editionDate) throw new Error('La date des données ne correspond pas à l’édition.');
    const availableImages = await availableImageSources(config.webRoot,edition.articles);
    pending.push({path:htmlPath,label:'web/' + editionDate + '.html',bytes:Buffer.from(illustratePublishedHTML(html,edition,{availableImages}))});
  }
  const changes = [];
  for (const item of pending) {
    const before = await readOptional(item.path);
    if (!before || !before.equals(item.bytes)) changes.push({...item,before});
  }
  if (!changes.length) return {changed:[],backup:null};
  const backup = resolve(config.cortexRoot,'data/backups','journal-images-' + new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(backup,{recursive:true});
  const applied = [];
  try {
    for (const item of changes) {
      if (item.before) await atomicWrite(resolve(backup,item.label),item.before);
      await atomicWrite(item.path,item.bytes);
      applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      if (item.before) await atomicWrite(item.path,item.before);
      else await unlink(item.path);
    }
    throw error;
  }
  await writeFile(resolve(backup,'installation.json'), JSON.stringify({changes:changes.map(item=>({path:item.path,backup:item.before ? item.label : null}))},null,2) + '\n');
  return {changed:changes.map(item=>item.path),backup};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, config = {};
  const args = process.argv.slice(2);
  for (let i=0;i<args.length;i+=2) {
    if (!args[i+1] || !['--edition','--journal-project','--web-root','--cortex-root'].includes(args[i])) throw new Error('Arguments invalides.');
    if (args[i] === '--edition') options.editionDate=args[i+1];
    else config[{'--journal-project':'journalProject','--web-root':'webRoot','--cortex-root':'cortexRoot'}[args[i]]]=args[i+1];
  }
  installImages(config,options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
