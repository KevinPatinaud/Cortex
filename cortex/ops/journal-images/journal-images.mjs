import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';

const asset = (key, alt, caption) => Object.freeze({
  src: `/journal/images/${key}-v1.webp`, alt, caption,
  credit: 'Visuel généré par IA pour Le Journal', kind: 'illustration', width: 1536, height: 1024
});
export const imageCatalog = Object.freeze({
  energy: asset('energy', 'Un pistolet de pompe à carburant dans une station-service sans marque.', 'Carburants et énergie : illustration de contexte.'),
  economy: asset('economy', 'Des pièces de monnaie, un carnet et un stylo sur une table.', 'Budgets, épargne et pouvoir d’achat : illustration de contexte.'),
  technology: asset('technology', 'Vue rapprochée d’un circuit électronique et de son processeur.', 'Informatique et technologies : illustration de contexte.'),
  science: asset('science', 'De la verrerie de laboratoire et une jeune plante, devant un microscope.', 'Recherche et sciences du vivant : illustration de contexte.')
});
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function validImageSource(src) {
  return typeof src === 'string' && /^\/journal\/images\/[a-z0-9][a-z0-9_-]{0,150}\.(?:webp|jpg|jpeg|png)$/.test(src);
}
function reference(value) {
  if (typeof value !== 'string' || /\s|[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    for (const key of url.searchParams.keys()) if (/token|password|secret|api.?key|authorization/i.test(key)) return null;
    return value;
  } catch { return null; }
}
// Images are an optional enhancement. Malformed or incomplete image metadata
// must neither introduce an arbitrary resource nor block the daily newspaper.
export function normalizeImage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {src} = value;
  const alt = text(value.alt), caption = text(value.caption), credit = text(value.credit);
  if (!validImageSource(src) || !alt || alt.length > 500 || caption.length > 800 || !credit || credit.length > 400) return null;
  const kind = value.kind;
  if (!['illustration', 'photo'].includes(kind)) return null;
  const sourceUrl = value.sourceUrl == null ? null : reference(value.sourceUrl);
  if (value.sourceUrl != null && !sourceUrl) return null;
  const license = text(value.license);
  if (kind === 'photo' && (!sourceUrl || !license || license.length > 150)) return null;
  const dimension = number => Number.isInteger(number) && number > 0 && number <= 8000;
  if (!dimension(value.width) || !dimension(value.height)) return null;
  return {src, alt, caption, credit, kind, sourceUrl, license, width:value.width, height:value.height};
}

export function suggestIllustration(article) {
  const title = normal(article.title);
  const context = title + ' ' + normal(article.category);
  // Symbolic still lifes are unsuitable as depictions of a disaster, conflict,
  // court case or personal diagnosis. Explicit, credited photos remain possible.
  if (/\b(?:guerre|attaque[s]?|mort[s]?|deces|catastrophe|attentat|victime[s]?|tribunal|condamnation|diagnostic)\b/.test(title)) return null;
  if (/\b(?:gazole|diesel|carburant[s]?|essence|petrole|petrolier[s]?|station.service)\b/.test(title)) return 'energy';
  if (/\b(?:budget|fiscal|fiscale|impot[s]?|taxe[s]?|retraite[s]?|pension[s]?|inflation|epargne|pouvoir d.achat|credit immobilier|dette|taux d.usure|economi(?:e|que))\b/.test(title)) return 'economy';
  if (/\b(?:informatique|logiciel[s]?|cybersecurite|processeur[s]?|semiconducteur[s]?|openai|gpt|chatgpt|codex|claude|ia|intelligence artificielle|technologie|technologies)\b/.test(context)) return 'technology';
  if (/\b(?:biologie|biologique|laboratoire[s]?|recherche scientifique|biodiversite|sciences du vivant)\b/.test(context)) return 'science';
  return null;
}

export function selectEditorialImages(articles, {availableImages, enabled = true, maximum = 4} = {}) {
  const used = new Set();
  return articles.map(article => {
    if (!enabled || used.size >= maximum || article.image === null || article.illustration === null) return {...article, image:null};
    let selected;
    if (Object.hasOwn(article, 'image')) selected = normalizeImage(article.image);
    else {
      const key = Object.hasOwn(article, 'illustration') ? article.illustration : suggestIllustration(article);
      selected = typeof key === 'string' && Object.hasOwn(imageCatalog, key) ? normalizeImage(imageCatalog[key]) : null;
    }
    if (!selected || used.has(selected.src) || (availableImages && !availableImages.has(selected.src))) return {...article, image:null};
    used.add(selected.src);
    return {...article, image:selected};
  });
}

export async function availableImageSources(webRoot, articles = []) {
  const candidates = [...Object.values(imageCatalog), ...articles.map(article => normalizeImage(article.image)).filter(Boolean)];
  const available = new Set();
  await Promise.all(candidates.map(async ({src}) => {
    try {
      const stat = await lstat(resolve(webRoot, 'images', src.split('/').pop()));
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0) available.add(src);
    } catch { /* Missing illustrations never prevent publication. */ }
  }));
  return available;
}

export function imageHTML(value, {priority = false} = {}) {
  const image = normalizeImage(value);
  if (!image) return '';
  const credit = image.sourceUrl ? `<a href="${esc(image.sourceUrl)}" rel="noopener noreferrer">${esc(image.credit)}</a>` : esc(image.credit);
  const caption = [image.kind === 'illustration' ? 'Illustration' : 'Photographie', image.caption].filter(Boolean).join(' — ');
  return `<figure class="journal-figure"><img data-journal-image src="${esc(image.src)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="${priority ? 'eager' : 'lazy'}" decoding="async"><figcaption><span>${esc(caption)}</span> <small>${credit}${image.license ? ` · ${esc(image.license)}` : ''}</small></figcaption></figure>`;
}

export function verifyImageTags(tags) {
  for (const tag of tags.match(/<img\b[^>]*>/gi) || []) {
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (!/\bdata-journal-image(?:\s|>)/.test(tag) || !validImageSource(src) || !/\balt="[^"]+"/.test(tag) || /\b(?:srcset|style)\s*=/i.test(tag)) {
      throw new Error('Image non autorisée dans le journal.');
    }
  }
}

export const imageCSS = `
/* BEGIN journal-images */
.journal-figure{margin:24px 0 30px;max-width:100%;break-inside:avoid}
.journal-figure img{display:block;width:100%;max-width:100%;height:auto;border-radius:8px;background:#203039}
.journal-figure figcaption{font:12px/1.6 system-ui,sans-serif;color:var(--muted,#a8b8c2);margin-top:9px;overflow-wrap:anywhere}
.journal-figure figcaption small{display:block;font-size:10px;margin-top:3px}
.journal-figure figcaption a{color:inherit;text-decoration:underline;text-underline-offset:3px}
@media(max-width:480px){.journal-figure{margin:20px 0 24px}.journal-figure img{border-radius:5px}}
@media print{.journal-figure figcaption{color:#444}.journal-figure img{border-radius:0;max-height:8cm;object-fit:contain}}
/* END journal-images */
`;
