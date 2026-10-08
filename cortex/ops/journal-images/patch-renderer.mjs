import {imageCSS, imageHTML, selectEditorialImages} from './journal-images.mjs';

function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('Gabarit du journal différent : modification automatique interrompue.');
  }
  return source.replace(before, after);
}

export function patchRenderer(source) {
  if (source.includes("from './journal-images.mjs'")) {
    if (source.includes('const displayData = await hydrateNewsImages(data,directory);')) return source;
    source = replaceOnce(source, 'import {availableImageSources, selectEditorialImages, imageHTML, imageCSS, verifyImageTags}', 'import {hydrateNewsImages, availableImageSources, selectEditorialImages, imageHTML, imageCSS, verifyImageTags}');
    return replaceOnce(source,"  const availableImages = await availableImageSources('/var/www/KevinPatinaud/journal',data.articles);\n  const html = renderJournal(data,{css,script,availableImages});",
      "  const displayData = await hydrateNewsImages(data,directory);\n  const availableImages = await availableImageSources('/var/www/KevinPatinaud/journal',displayData.articles);\n  const html = renderJournal(displayData,{css,script,availableImages});");
  }
  source = replaceOnce(source, "import {restoreWriterArticles} from './article-fidelity.mjs';",
    "import {restoreWriterArticles} from './article-fidelity.mjs';\nimport {availableImageSources, selectEditorialImages, imageHTML, imageCSS, verifyImageTags} from './journal-images.mjs';");
  source = replaceOnce(source, 'export function renderJournal(input, {css,script} = {}) {',
    'export function renderJournal(input, {css,script,availableImages} = {}) {');
  source = replaceOnce(source, '  const data = normalizeData(input);',
    '  const data = normalizeData(input);\n  data.articles = selectEditorialImages(data.articles,{availableImages,enabled:input.images !== false});\n  css += imageCSS;');
  source = replaceOnce(source, '</h3></header><div class="prose">${article.rendered.html}',
    '</h3></header>${imageHTML(article.image)}<div class="prose">${article.rendered.html}');
  source = replaceOnce(source, '  if (/<(?:iframe|object|embed|img|script|link)\\b/i.test(tags)',
    '  verifyImageTags(tags);\n  if (/<(?:iframe|object|embed|script|link)\\b/i.test(tags)');
  source = replaceOnce(source, '  const html = renderJournal(data,{css,script});',
    "  const availableImages = await availableImageSources('/var/www/KevinPatinaud/journal',data.articles);\n  const html = renderJournal(data,{css,script,availableImages});");
  return patchRenderer(source);
}

export function illustratePublishedHTML(html, edition, {availableImages} = {}) {
  const selected = selectEditorialImages(edition.articles, {availableImages, enabled:edition.images !== false});
  let result = html.replace(/<figure class="journal-figure"><img data-journal-image\b[\s\S]*?<\/figure>/g,'')
    .replace(/\n\/\* BEGIN journal-images \*\/[\s\S]*?\/\* END journal-images \*\/\n/g,'');
  if (!selected.some(article => article.image)) return result;
  for (const [index, article] of selected.entries()) {
    if (!article.image) continue;
    const id = `article-${String(index + 1).padStart(2,'0')}`;
    const expression = new RegExp(`(<article\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/header>)(<div class="prose">)`);
    if (!expression.test(result)) throw new Error(`En-tête introuvable pour ${id} : aucune modification publiée.`);
    result = result.replace(expression, (_, header, prose) => header + imageHTML(article.image) + prose);
  }
  if (!result.includes('</style>')) throw new Error('Styles embarqués introuvables.');
  return result.replace('</style>', imageCSS + '</style>');
}

export const promptInstructions = `
<!-- BEGIN journal-images -->
## Images réelles de l’actualité

Les images doivent provenir de l’actualité traitée : vraies photographies publiées par une source fiable ou documents/infographies effectivement publiés par cette source. Privilégie les photos de l’événement ou des personnes et lieux concernés. Aucune image générée par IA, banque décorative générique, logo de repli, ni sélection par mots-clés dans une bibliothèque fixe. Le Rédacteur journalistique recherche et importe les images pendant sa recherche documentaire.

Avant la publication, consulte .cortex/journal/news-images/AAAA-MM-JJ/ : chaque fiche fournit le titre exact de l’article, une source utilisée par l’article, l’image locale, la page d’origine, sa légende, son crédit et les droits vérifiés. Le renderer charge automatiquement les fiches du jour correspondant au titre et à une source de chaque article, et vérifie le fichier avant affichage. Conserve le titre du rédacteur et l’intégralité de son Markdown pour permettre ce rapprochement. N’insère pas les fiches d’images dans le texte des articles et n’invente pas de fichier ou de métadonnées. Les fichiers image sont séparés du Markdown afin de préserver la fidélité des articles.

Intègre une image pertinente par article, sans doublons, dans la limite de huit images. Les légendes identifient précisément la scène et la source ; une photographie d’archive ou de contexte est annoncée comme telle. La date de publication d’une page ne prouve pas la date de prise de vue. Si une image est inadéquate, ambiguë ou sans droits de republication établis, image: null désactive cet article. images: false désactive toute l’édition. Si aucune image utilisable n’a été trouvée, publie l’article sans image. Ne remplace jamais une photo manquante par une image artificielle.

Utilise obligatoirement le renderer habituel, qui ajoute les images créditées depuis /journal/images/news-AAAA-MM-JJ-empreinte.jpg (ou png/webp). Ne réécris pas le HTML à la main. Les images sont hébergées localement sans suivi ni chargement depuis les sites sources lors de la lecture. L’absence d’une image ne bloque jamais le journal. La notification mail et les étapes du workflow restent inchangées.
<!-- END journal-images -->
`;

export const writerInstructions = `
<!-- BEGIN journal-news-images -->
## Rechercher une image réelle pour cet article

Pendant ta recherche documentaire, cherche aussi une vraie photographie liée à ce sujet, de préférence publiée avec l’actualité dans une source officielle, un média fiable ou une photothèque de presse. Une infographie ou un document source publié est également possible si cela éclaire l’article. N’utilise aucune image générée par IA, aucune banque décorative générique et aucun logo de repli. Ne prends pas automatiquement l’og:image : il peut s’agir d’un logo ou d’une image sans rapport.

Ouvre et examine l’image candidate. Vérifie la scène, les personnes et le contexte à partir de la légende de la source. Ne confonds pas date de publication et date de prise de vue ; signale dans la légende une archive ou une photo de contexte, et toute date non précisée. Retrouve le crédit exact et une autorisation de republication applicable à cette image (licence ouverte ou conditions explicites de l’éditeur/photothèque). La présence d’une photo sur Internet, un crédit AFP/Reuters/Adobe Stock, ou l’accès gratuit à une page ne vaut pas autorisation. Cherche une alternative réutilisable ; si rien ne convient, termine l’article sans image.

Pour importer une image vérifiée, écris un JSON séparé à un chemin unique dans .cortex/journal/news-images/candidates/ ; utilise un nom unique par article pour éviter les collisions entre rédacteurs. Champs obligatoires : editionDate (date du journal en Europe/Paris), articleTitle (titre exact livré dans ton article), articleSourceUrl (URL effectivement présente dans les sources de ton article), imageUrl (URL HTTPS du fichier JPEG/PNG/WebP), sourceUrl (page donnant contexte et crédit), origin: "published", kind: "photo" ou "graphic", alt (description accessible), caption (légende précise), credit, license, licenseUrl (page autorisant la republication), rightsNote (preuve textuelle et conditions de réutilisation vérifiées), relation (pourquoi cette image correspond au sujet), visualVerified: true et rightsVerified: true. Champs utiles : sourcePublishedAt (AAAA-MM-JJ), photoDate (AAAA-MM-JJ ou null si inconnue). N’invente aucune de ces informations.

Exécute ensuite : node ".cortex/journal/import-news-image.mjs" --candidate "CHEMIN-UNIQUE.json". L’outil télécharge le fichier original et sauvegarde une fiche datée et son empreinte. Vérifie que la commande a réussi. Ne contourne pas un refus d’accès, ne fournis pas d’identifiants et ne télécharge pas une image payante sans autorisation. Un téléchargement impossible ou une image trop lourde ne doit pas bloquer ton article ; choisis une autre image si elle convient.

Rends toujours uniquement l’article journalistique complet en Markdown avec ses sources. N’ajoute pas le JSON, la commande, ni un rapport technique dans le corps de l’article. Synthèse et le renderer retrouvent la fiche séparément. Ne modifie ni l’édition publiée, ni les autres articles, ni le mail.
<!-- END journal-news-images -->
`;

export function patchWriterPrompt(prompt) {
  const block=/\n<!-- BEGIN journal-news-images -->[\s\S]*?<!-- END journal-news-images -->\n/;
  if(prompt.includes('<!-- BEGIN journal-news-images -->') && !block.test(prompt)) throw new Error('Consignes de collecte incomplètes.');
  return block.test(prompt) ? prompt.replace(block,()=>writerInstructions) : prompt+writerInstructions;
}

export function patchImagePrompt(prompt) {
  const updated = prompt.replace('Aucun fichier CSS, JavaScript ou média séparé ne doit être indispensable à sa lecture.',
    'Les textes, le CSS et les commandes de lecture sont embarqués. Des images peuvent être chargées depuis le site du journal ; leur absence ne doit pas empêcher la lecture.');
  const block = /\n<!-- BEGIN journal-images -->[\s\S]*?<!-- END journal-images -->\n/;
  if (updated.includes('<!-- BEGIN journal-images -->') && !block.test(updated)) throw new Error('Consignes de visuels incomplètes.');
  return block.test(updated) ? updated.replace(block, () => promptInstructions) : updated + promptInstructions;
}
