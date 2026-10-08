import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {selectEditorialImages,normalizeImage,imageHTML,validImageSource,verifyImageTags,availableImageSources,hydrateNewsImages} from './journal-images.mjs';
import {patchRenderer,patchImagePrompt,patchWriterPrompt,illustratePublishedHTML} from './patch-renderer.mjs';
import {installImages} from './install.mjs';
import {importNewsImage,publicAddress,rasterInfo,downloadImage} from './import-news-image.mjs';

const source=dirname(fileURLToPath(import.meta.url));
const bytes=Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,100,0,200,1,1,0x11,0,0xff,0xd9]);
const sha256=createHash('sha256').update(bytes).digest('hex');
const photo={src:`/journal/images/news-2026-10-08-${sha256.slice(0,16)}.jpg`,sha256,alt:'La personne citée.',caption:'Photo de contexte ; date de prise de vue non précisée.',credit:'Photographe / Éditeur',kind:'photo',origin:'published',sourceUrl:'https://example.org/photo',imageUrl:'https://example.org/photo.jpg',license:'CC BY 4.0',licenseUrl:'https://example.org/licence',rightsNote:'Republication autorisée avec attribution.',width:200,height:100};
const article=(title='Gazole',extra={})=>({title,markdown:'# '+title+'\n\nTexte intégral.\nSource : https://example.org/article',...extra});
const candidate={...photo,editionDate:'2026-10-08',articleTitle:'Gazole',articleSourceUrl:'https://example.org/article',visualVerified:true,rightsVerified:true,relation:'La personne ayant annoncé la mesure.'};
const skeleton=`import {restoreWriterArticles} from './article-fidelity.mjs';
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
const prose='<div class="prose"><p>Un paragraphe complet.</p><a href="https://example.org/?a=1&amp;b=2">La source</a></div>';
const html='<!doctype html><html lang="fr"><head><style>body{margin:0}</style></head><body><article id="article-01"><header><h3>Gazole</h3></header>'+prose+'</article><footer class="page-footer">Date originale</footer><script>const original = 1;</script></body></html>';
async function fixture(prefix,run) {const root=await mkdtemp(resolve(tmpdir(),prefix));try{return await run(root);}finally{assert.ok(root.startsWith(resolve(tmpdir(),prefix)));await rm(root,{recursive:true,force:true});}}

test('aucun repli IA ; sélection sans doublon et sans altérer les textes',()=>{
  const items=[article(),article('Budget',{illustration:'economy'}),article('GPT-6',{image:{...photo,kind:'illustration'}})],before=JSON.stringify(items);
  assert.deepEqual(selectEditorialImages(items).map(item=>item.image),[null,null,null]);assert.equal(JSON.stringify(items),before);
  const selected=selectEditorialImages([article('Gazole',{image:photo}),article('Autre',{image:photo})]);
  assert.equal(selected[0].image.src,photo.src);assert.equal(selected[1].image,null);assert.equal(selected[0].markdown,article().markdown);
  for(const options of [{availableImages:new Set()},{enabled:false}]) assert.equal(selectEditorialImages([article('Gazole',{image:photo})],options)[0].image,null);
});
test('origine publiée, crédit, droits, provenance et empreinte obligatoires',()=>{
  assert.ok(normalizeImage(photo));assert.ok(normalizeImage({...photo,kind:'graphic'}));
  for(const key of ['origin','credit','license','licenseUrl','rightsNote','sourceUrl','imageUrl','sha256','alt']) assert.equal(normalizeImage({...photo,[key]:null}),null,key);
  assert.equal(normalizeImage({...photo,origin:'generated'}),null);assert.equal(normalizeImage({...photo,sha256:'b'.repeat(64)}),null);
  for(const src of ['/journal/images/energy-v1.webp','https://example.org/x.jpg','/journal/images/../secret.png','data:image/png;base64,eA==',photo.src+'?token=x']) assert.equal(validImageSource(src),false);
  assert.equal(normalizeImage({...photo,sourceUrl:'https://example.org/?token=secret'}),null);
});
test('légende, crédit et licence échappés ; pas de ressource distante',()=>{
  const result=imageHTML({...photo,alt:'Photo "<script>',caption:'Contexte <img onerror=x>'});
  assert.match(result,/Photographie — Contexte &lt;img onerror=x&gt;/);assert.match(result,/alt="Photo &quot;&lt;script&gt;"/);assert.match(result,/width="200" height="100" loading="lazy"/);assert.match(result,/href="https:\/\/example.org\/licence"/);
  assert.doesNotMatch(result,/<script>/);assert.doesNotThrow(()=>verifyImageTags(result));assert.equal(imageHTML(null),'');
  assert.throws(()=>verifyImageTags('<img src="https://tracker.example/a.jpg" alt="x">'));
  assert.throws(()=>verifyImageTags(`<img data-journal-image src="${photo.src}" alt="x" srcset="https://tracker.example/a">`));
});
test('fichier absent, modifié ou symlink : image ignorée',async()=>fixture('news-image-files-',async root=>{
  await mkdir(resolve(root,'images'));const articles=[article('Gazole',{image:photo})],path=resolve(root,'images',photo.src.split('/').pop());
  assert.equal((await availableImageSources(root,articles)).size,0);await writeFile(path,bytes);assert.deepEqual([...await availableImageSources(root,articles)],[photo.src]);
  await writeFile(path,'different');assert.equal((await availableImageSources(root,articles)).size,0);
  if(process.platform!=='win32'){await rm(path);await writeFile(resolve(root,'other'),bytes);await symlink(resolve(root,'other'),path);assert.equal((await availableImageSources(root,articles)).size,0);}
}));
test('fiche rapprochée par jour, titre ET source ; données malformées ignorées',async()=>fixture('news-image-records-',async root=>{
  const directory=resolve(root,'news-images/2026-10-08');await mkdir(directory,{recursive:true});const path=resolve(directory,'a'.repeat(16)+'-'+sha256.slice(0,16)+'.json');
  await writeFile(path,JSON.stringify({editionDate:'2026-10-08',articleTitle:'Gazole',articleSourceUrl:'https://example.org/article',image:photo}));
  const edition={editionDate:'2026-10-08',articles:[article()]},before=JSON.stringify(edition);assert.equal((await hydrateNewsImages(edition,root)).articles[0].image.src,photo.src);assert.equal(JSON.stringify(edition),before);
  for(const changed of [{editionDate:'2026-10-09',articles:[article()]},{...edition,articles:[article('Autre')]},{...edition,articles:[article('Gazole',{markdown:'Aucune source'})]},{...edition,articles:[article('Gazole',{image:null})]}]) assert.equal((await hydrateNewsImages(changed,root)).articles[0].image??null,null);
  await writeFile(path,'{malformed');assert.deepEqual(await hydrateNewsImages(edition,root),edition);
}));
test('patch du renderer borné et idempotent, collecte après fidélité',()=>{
  const result=patchRenderer(skeleton);assert.match(result,/hydrateNewsImages\(data,directory\)/);assert.match(result,/verifyImageTags\(tags\)/);assert.match(result,/\$\{imageHTML\(article.image\)\}/);assert.equal(patchRenderer(result),result);assert.throws(()=>patchRenderer('Gabarit inconnu'));
});
test('remplacer les visuels IA conserve paragraphes, liens, scripts et date',()=>{
  const old=html.replace('</header>','</header><figure class="journal-figure"><img data-journal-image src="/journal/images/energy-v1.webp"><figcaption>Visuel généré par IA</figcaption></figure>');
  const edition={articles:[article('Gazole',{image:photo})]},result=illustratePublishedHTML(old,edition);
  assert.match(result,/data-journal-image/);assert.doesNotMatch(result,/energy-v1|généré par IA/);assert.ok(result.includes(prose));assert.ok(result.endsWith('<footer class="page-footer">Date originale</footer><script>const original = 1;</script></body></html>'));assert.equal(illustratePublishedHTML(result,edition),result);
  assert.equal(illustratePublishedHTML(old,{images:false,...edition}),html);assert.equal(illustratePublishedHTML(old,{articles:[article()]}),html);assert.throws(()=>illustratePublishedHTML(html.replace('article-01','other'),edition));
});
test('prompts : recherche au rédacteur, intégration à Synthèse, aucune IA',()=>{
  for(const patch of [patchImagePrompt,patchWriterPrompt]){const original='Consignes originales.',result=patch(original);assert.equal(patch(result),result);assert.ok(result.startsWith(original));assert.ok(patch(result+'\nAutre consigne.').endsWith('Autre consigne.'));assert.match(result,/aucune image générée par IA/i);}
  assert.match(patchWriterPrompt('Original'),/import-news-image.mjs/);assert.match(patchImagePrompt('Original'),/notification mail/);assert.throws(()=>patchImagePrompt('<!-- BEGIN journal-images -->'));
});
test('téléchargement : IP privées, HTTP, port non standard et faux fichier refusés',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','172.16.2.3','100.64.1.1','::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('1.1.1.1'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  await assert.rejects(()=>downloadImage('https://127.0.0.1/a.jpg'),/non publique/);await assert.rejects(()=>downloadImage('http://example.org/a.jpg'),/HTTPS/);await assert.rejects(()=>downloadImage('https://example.org:3000/a.jpg'),/HTTPS/);
  for(const value of ['<html>Not a photograph</html>','<svg></svg>','RIFFfake']) assert.throws(()=>rasterInfo(Buffer.from(value)));
});
test('import original et fiche séparée, rapprochement et affichage',async()=>fixture('news-image-import-',async root=>{
  const download=async()=>({bytes,type:'image/jpeg',downloadUrl:candidate.imageUrl}),config={journalDirectory:resolve(root,'journal'),webRoot:resolve(root,'web')};
  assert.deepEqual(rasterInfo(bytes),{type:'image/jpeg',extension:'jpg',width:200,height:100});const result=await importNewsImage(candidate,config,{download});
  assert.ok((await readFile(resolve(config.webRoot,'images',result.src.split('/').pop()))).equals(bytes));assert.equal((await readdir(resolve(config.journalDirectory,'news-images/2026-10-08'))).length,1);assert.deepEqual(await importNewsImage(candidate,config,{download}),result);
  const edition=await hydrateNewsImages({editionDate:'2026-10-08',articles:[article()]},config.journalDirectory),availableImages=await availableImageSources(config.webRoot,edition.articles);assert.match(illustratePublishedHTML(html,edition,{availableImages}),/Photographie/);
  await assert.rejects(()=>importNewsImage({...candidate,rightsVerified:false},config,{download}),/vérifications/);await assert.rejects(()=>importNewsImage({...candidate,origin:'generated'},config,{download}),/incomplètes/);await assert.rejects(()=>importNewsImage(candidate,config,{download:async()=>({bytes,type:'image/png'})}),/type déclaré/);
}));
test('installation sauvegardée et idempotente sans génération ni mail',async()=>{
  const root=await mkdtemp(resolve(source,'.test-install-')),journalProject=resolve(root,'project'),webRoot=resolve(root,'web');
  try {
    await mkdir(resolve(journalProject,'.cortex/journal/editions'),{recursive:true});await mkdir(resolve(journalProject,'.codex/agents'),{recursive:true});await mkdir(webRoot);
    await writeFile(resolve(journalProject,'.cortex/journal/render-journal.mjs'),skeleton);for(const agent of ['synthese','redacteur-journalistique']) await writeFile(resolve(journalProject,'.codex/agents',agent+'.toml'),'name = "Agent"\ndeveloper_instructions = "Consignes originales."\n');
    await writeFile(resolve(journalProject,'.cortex/journal/editions/2026-10-08.json'),JSON.stringify({editionDate:'2026-10-08',articles:[article()]}));const old=html.replace('</header>','</header><figure class="journal-figure"><img data-journal-image src="/journal/images/energy-v1.webp"><figcaption>IA</figcaption></figure>');await writeFile(resolve(webRoot,'2026-10-08.html'),old);
    const config={journalProject,webRoot,cortexRoot:root},first=await installImages(config,{editionDate:'2026-10-08'});assert.ok(first.backup);assert.equal(await readFile(resolve(first.backup,'web/2026-10-08.html'),'utf8'),old);assert.equal(await readFile(resolve(webRoot,'2026-10-08.html'),'utf8'),html);assert.match(await readFile(resolve(journalProject,'.codex/agents/redacteur-journalistique.toml'),'utf8'),/import-news-image.mjs/);assert.equal((await installImages(config,{editionDate:'2026-10-08'})).changed.length,0);
  } finally {assert.ok(root.startsWith(resolve(source,'.test-install-')));await rm(root,{recursive:true,force:true});}
});
