import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {imageCatalog, selectEditorialImages, suggestIllustration, normalizeImage, imageHTML, validImageSource, verifyImageTags, availableImageSources} from './journal-images.mjs';
import {patchRenderer, patchImagePrompt, illustratePublishedHTML} from './patch-renderer.mjs';
import {installImages} from './install.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const article = (title, extra={}) => ({title,markdown:'# Titre\n\nTexte intégral avec sa source https://example.org.',...extra});
const skeleton = `import {restoreWriterArticles} from './article-fidelity.mjs';
function verifyHTML(tags) {
  if (/<(?:iframe|object|embed|img|script|link)\\b/i.test(tags)) throw new Error('Element interdit');
}
export function renderJournal(input, {css,script} = {}) {
  const data = normalizeData(input);
  const html = '\\n</h3></header><div class="prose">\u0024{article.rendered.html}';
  return html;
}
async function cli() {
  const html = renderJournal(data,{css,script});
}`;
const body = '<article class="story" id="article-01"><header><h3>Gazole</h3></header><div class="prose"><p>Un paragraphe complet.</p><a href="https://example.org/?a=1&amp;b=2">La source</a></div></article>';
const html = '<!doctype html><html lang="fr"><head><style>body{margin:0}</style></head><body><main>' + body + '</main><footer class="page-footer">Date originale</footer><script>const original = 1;</script></body></html>';

test('la sélection conserve le contenu, varie les images et respecte le sujet', () => {
  const items = [article('Prix du gazole'),article('Budget 2027 et pensions'),article('GPT-6 et les outils informatiques'),article('Biodiversité et recherche scientifique'),article('Inflation des prix')];
  const before=JSON.stringify(items);
  const selected=selectEditorialImages(items);
  assert.equal(JSON.stringify(items),before);
  assert.deepEqual(selected.map(item=>item.image?.src),[imageCatalog.energy.src,imageCatalog.economy.src,imageCatalog.technology.src,imageCatalog.science.src,undefined]);
  assert.deepEqual(selected.map(item=>item.markdown),items.map(item=>item.markdown));
  assert.equal(suggestIllustration(article('Une attaque sur un site pétrolier')),null);
  assert.equal(suggestIllustration(article('Le programme nucléaire et ses réacteurs',{category:'Énergie'})),null);
  assert.equal(suggestIllustration(article('Une fête au village')),null);
});

test('désactivation par article ou édition, choix manuel et image manquante', () => {
  assert.equal(selectEditorialImages([article('Gazole',{image:null})])[0].image,null);
  assert.equal(selectEditorialImages([article('Gazole',{illustration:null})])[0].image,null);
  assert.equal(selectEditorialImages([article('Gazole')],{enabled:false})[0].image,null);
  assert.equal(selectEditorialImages([article('Gazole')],{availableImages:new Set()})[0].image,null);
  assert.equal(selectEditorialImages([article('Un budget',{illustration:'technology'})])[0].image.src,imageCatalog.technology.src);
  for(const invalid of [42,{},'unknown']) assert.equal(selectEditorialImages([article('Gazole',{illustration:invalid})])[0].image,null);
});

test('les ressources externes, chemins et paramètres ne sont jamais affichés', () => {
  for(const src of ['https://example.org/image.jpg','//example.org/x.jpg','/journal/images/../secret.png','/journal/images/a.svg','/journal/images/a.webp?token=secret','data:image/png;base64,eA==','javascript:alert(1)']) {
    assert.equal(validImageSource(src),false);
    assert.equal(normalizeImage({...imageCatalog.energy,src}),null);
  }
  assert.equal(normalizeImage({...imageCatalog.energy,alt:''}),null);
  assert.equal(normalizeImage({...imageCatalog.energy,width:0}),null);
  assert.equal(normalizeImage({...imageCatalog.energy,sourceUrl:'https://example.org/?token=secret'}),null);
  assert.equal(normalizeImage({...imageCatalog.energy,sourceUrl:null}).src,imageCatalog.energy.src);
});

test('une photographie exige un crédit, une provenance et une licence', () => {
  const photo={...imageCatalog.energy,kind:'photo',credit:'Photographe',sourceUrl:'https://example.org/original',license:'CC BY 4.0'};
  assert.equal(normalizeImage(photo).kind,'photo');
  assert.equal(normalizeImage({...photo,sourceUrl:undefined}),null);
  assert.equal(normalizeImage({...photo,license:''}),null);
  assert.equal(normalizeImage({...photo,credit:''}),null);
});

test('texte alternatif, légende, crédit et dimensions sont accessibles et échappés', () => {
  const result=imageHTML({...imageCatalog.energy,alt:'Une pompe "<script>',caption:'Contexte <img onerror=x>'});
  assert.match(result,/width="1536" height="1024" loading="lazy" decoding="async"/);
  assert.match(result,/alt="Une pompe &quot;&lt;script&gt;"/);
  assert.match(result,/Illustration — Contexte &lt;img onerror=x&gt;/);
  assert.match(result,/Visuel généré par IA/);
  assert.doesNotMatch(result,/<script>/);
  assert.equal(imageHTML(null),'');
  assert.doesNotThrow(()=>verifyImageTags(result.match(/<[A-Za-z][^>]*>/g).join('\n')));
  assert.throws(()=>verifyImageTags('<img src="https://tracker.example/a.jpg" alt="x">'));
  assert.throws(()=>verifyImageTags('<img data-journal-image src="/journal/images/a.webp" alt="x" srcset="https://tracker.example/a">'));
});

test('les assets absents ou liés symboliquement restent facultatifs', async () => {
  const root=await mkdtemp(resolve(tmpdir(),'journal-image-files-'));
  try {
    await mkdir(resolve(root,'images'));
    await writeFile(resolve(root,'images/energy-v1.webp'),'image');
    assert.deepEqual([...await availableImageSources(root)],[imageCatalog.energy.src]);
    if(process.platform!=='win32') {
      await symlink(resolve(root,'images/energy-v1.webp'),resolve(root,'images/economy-v1.webp'));
      assert.deepEqual([...await availableImageSources(root)],[imageCatalog.energy.src]);
    }
  } finally {assert.ok(root.startsWith(resolve(tmpdir(),'journal-image-files-')));await rm(root,{recursive:true,force:true});}
});

test('le patch du gabarit est borné, idempotent et conserve les autres règles', () => {
  const patched=patchRenderer(skeleton);
  assert.match(patched,/verifyImageTags\(tags\)/);
  assert.match(patched,/availableImageSources/);
  assert.match(patched,/\$\{imageHTML\(article.image\)\}/);
  assert.equal(patchRenderer(patched),patched);
  assert.throws(()=>patchRenderer('Un gabarit inconnu'));
});

test('l’ajout à une édition publiée ne réécrit aucun paragraphe, lien ou script', () => {
  const edition={articles:[article('Prix du gazole')]};
  const result=illustratePublishedHTML(html,edition);
  assert.match(result,/data-journal-image/);
  assert.ok(result.includes('<div class="prose"><p>Un paragraphe complet.</p><a href="https://example.org/?a=1&amp;b=2">La source</a></div>'));
  assert.ok(result.includes('<footer class="page-footer">Date originale</footer><script>const original = 1;</script>'));
  assert.equal(illustratePublishedHTML(result,edition),result);
  assert.equal(illustratePublishedHTML(html,{images:false,...edition}),html);
  assert.throws(()=>illustratePublishedHTML(html.replace('id="article-01"','id="other"'),edition));
});

test('les consignes restent idempotentes et préservent les ajouts extérieurs au bloc', () => {
  const prompt='Instructions. Aucun fichier CSS, JavaScript ou média séparé ne doit être indispensable à sa lecture.';
  const updated=patchImagePrompt(prompt);
  assert.equal(patchImagePrompt(updated),updated);
  assert.ok(patchImagePrompt(updated+'\n## Une autre consigne\nConserver.').endsWith('Conserver.'));
  assert.match(updated,/notification mail/);
  assert.throws(()=>patchImagePrompt('<!-- BEGIN journal-images -->'));
});

test('les quatre images livrées correspondent au manifeste et restent légères', async () => {
  const manifest=JSON.parse(await readFile(resolve(source,'assets.json'),'utf8'));
  assert.equal(manifest.length,4);
  assert.equal(new Set(manifest.map(item=>item.key)).size,4);
  for(const item of manifest) {
    const bytes=await readFile(resolve(source,'../journal-site/site/images',item.file));
    assert.equal(bytes.length,item.bytes);
    assert.ok(bytes.length<250000);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
    assert.equal(bytes.subarray(8,12).toString(),'WEBP');
  }
});

test('installation sauvegardée et réinstallation sans changement de contenu ou de mail', async () => {
  const root=await mkdtemp(resolve(source,'.test-install-'));
  const journalProject=resolve(root,'project'),webRoot=resolve(root,'web');
  try {
    await mkdir(resolve(journalProject,'.cortex/journal/editions'),{recursive:true});
    await mkdir(resolve(journalProject,'.codex/agents'),{recursive:true});
    await mkdir(webRoot);
    await writeFile(resolve(journalProject,'.cortex/journal/render-journal.mjs'),skeleton);
    await writeFile(resolve(journalProject,'.codex/agents/synthese.toml'),'name = "Synthèse"\ndeveloper_instructions = "Consignes originales."\n');
    await writeFile(resolve(journalProject,'.cortex/journal/editions/2026-10-08.json'),JSON.stringify({editionDate:'2026-10-08',articles:[article('Gazole')]}));
    await writeFile(resolve(webRoot,'2026-10-08.html'),html);
    const config={journalProject,webRoot,cortexRoot:root};
    const first=await installImages(config,{editionDate:'2026-10-08'});
    assert.ok(first.backup);
    assert.equal(await readFile(resolve(first.backup,'web/2026-10-08.html'),'utf8'),html);
    assert.match(await readFile(resolve(webRoot,'2026-10-08.html'),'utf8'),/data-journal-image/);
    assert.equal((await installImages(config,{editionDate:'2026-10-08'})).changed.length,0);
  } finally {assert.ok(root.startsWith(resolve(source,'.test-install-')));await rm(root,{recursive:true,force:true});}
});
