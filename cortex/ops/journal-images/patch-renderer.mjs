import {imageCSS, imageHTML, selectEditorialImages} from './journal-images.mjs';

function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('Gabarit du journal différent : modification automatique interrompue.');
  }
  return source.replace(before, after);
}

export function patchRenderer(source) {
  if (source.includes("from './journal-images.mjs'")) return source;
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
  return source;
}

export function illustratePublishedHTML(html, edition, {availableImages} = {}) {
  if (html.includes('data-journal-image')) return html;
  const selected = selectEditorialImages(edition.articles, {availableImages, enabled:edition.images !== false});
  if (!selected.some(article => article.image)) return html;
  let result = html;
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
## Visuels du journal personnel

Intègre des images lorsqu’elles éclairent un sujet ou améliorent la présentation. Le renderer ajoute automatiquement jusqu’à quatre illustrations de contexte, distinctes, issues de la bibliothèque locale ; leur absence ne doit jamais bloquer le journal. Les articles et leurs sources restent intégralement conservés.

Le JSON peut préciser illustration sur un article : "energy" (pompe à carburant, uniquement carburants), "economy" (monnaie et carnet, budgets/pouvoir d’achat), "technology" (circuit électronique, informatique/IA), "science" (verrerie et plante, recherche/sciences du vivant), ou null pour ne pas illustrer cet article. Si le champ est absent, le choix est automatique selon le titre et la catégorie. Ne force pas une illustration inadéquate. Évite les répétitions. images: false désactive les images de toute l’édition.

Pour une vraie photographie dont la provenance et le droit de réutilisation sont vérifiés, le champ facultatif image est {src, alt, caption, credit, kind: "photo", sourceUrl, license, width, height}. Le fichier doit déjà être présent dans /var/www/KevinPatinaud/journal/images/ ; src est /journal/images/nom.webp (ou jpg/png), sans paramètres. N’invente jamais un fichier, une source, une licence, une légende ou une photographie d’un événement. Si une photographie utilisable n’est pas effectivement disponible, conserve l’illustration de contexte ou aucun visuel. Les images Markdown non validées restent des liens.

Les visuels synthétiques sont explicitement légendés comme illustrations générées par IA. Ils ne représentent ni une photographie d’actualité, ni une personne réelle, ni une preuve. N’illustre pas automatiquement un conflit, une catastrophe, un dossier judiciaire ou une situation médicale personnelle avec une scène générée.

Les textes et les commandes de lecture restent disponibles si les images ne chargent pas. Les images sont servies par le site du journal, sans CDN ni outil de suivi. Ne régénère pas la bibliothèque et n’ajoute pas d’appel à un modèle d’image pendant la production quotidienne. La notification mail et les étapes du workflow restent inchangées.
<!-- END journal-images -->
`;

export function patchImagePrompt(prompt) {
  const updated = prompt.replace('Aucun fichier CSS, JavaScript ou média séparé ne doit être indispensable à sa lecture.',
    'Les textes, le CSS et les commandes de lecture sont embarqués. Des images peuvent être chargées depuis le site du journal ; leur absence ne doit pas empêcher la lecture.');
  const block = /\n<!-- BEGIN journal-images -->[\s\S]*?<!-- END journal-images -->\n/;
  if (updated.includes('<!-- BEGIN journal-images -->') && !block.test(updated)) throw new Error('Consignes de visuels incomplètes.');
  return block.test(updated) ? updated.replace(block, () => promptInstructions) : updated + promptInstructions;
}
