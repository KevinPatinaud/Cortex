import {lstat, readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function validImageSource(src) {
  return typeof src === 'string' && /^\/journal\/images\/news-\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.(?:webp|jpg|png)$/.test(src);
}
export function reference(value) {
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
  if (!['photo', 'graphic'].includes(kind) || value.origin !== 'published') return null;
  const sourceUrl = reference(value.sourceUrl), imageUrl = reference(value.imageUrl), licenseUrl = reference(value.licenseUrl);
  const license = text(value.license);
  const rightsNote = text(value.rightsNote), sha256 = text(value.sha256);
  if (!sourceUrl || !imageUrl || !licenseUrl || !license || license.length > 150 || !rightsNote || rightsNote.length > 2000 || !/^[a-f0-9]{64}$/.test(sha256) || !src.includes(sha256.slice(0,16))) return null;
  const dimension = number => Number.isInteger(number) && number > 0 && number <= 8000;
  if (!dimension(value.width) || !dimension(value.height)) return null;
  return {src, alt, caption, credit, kind, origin:'published', sourceUrl, imageUrl, license, licenseUrl, rightsNote, sha256, width:value.width, height:value.height};
}

export function validEditionDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
}

function sourceMatches(article, url) {
  if (!reference(url)) return false;
  const urls = [...String(article.markdown || '').matchAll(/https:\/\/[^\s<>"')\]]+/g)].map(match=>match[0]);
  for (const source of article.sources || []) if (typeof source === 'object' && source.url) urls.push(source.url);
  return urls.includes(url);
}

// Writers save media separately so the fidelity guard can keep their complete
// article Markdown. Edition date + exact title + article source prevent a
// cached image being silently attached to a different story or later edition.
export async function hydrateNewsImages(edition, journalDirectory) {
  if (!validEditionDate(edition.editionDate) || !Array.isArray(edition.articles)) return edition;
  const directory = resolve(journalDirectory,'news-images',edition.editionDate);
  let files;
  try { files = await readdir(directory); } catch { return edition; }
  const records = [];
  for (const file of files.sort().filter(name=>/^[a-f0-9]{16}-[a-f0-9]{16}\.json$/.test(name))) {
    try {
      const path = resolve(directory,file), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16000) continue;
      const record = JSON.parse(await readFile(path,'utf8'));
      const image = normalizeImage(record.image);
      if (record.editionDate === edition.editionDate && image && image.src.startsWith('/journal/images/news-' + edition.editionDate + '-')) records.push({...record,image});
    } catch { /* A failed optional asset must not prevent the newspaper. */ }
  }
  return {...edition,articles:edition.articles.map(article=>{
    if (article.image === null) return article;
    const record = records.find(item=>normal(item.articleTitle) === normal(article.title) && sourceMatches(article,item.articleSourceUrl));
    return record ? {...article,image:record.image} : article;
  })};
}

export function selectEditorialImages(articles, {availableImages, enabled = true, maximum = 8} = {}) {
  const used = new Set();
  return articles.map(article => {
    if (!enabled || used.size >= maximum) return {...article, image:null};
    const selected = normalizeImage(article.image);
    if (!selected || used.has(selected.src) || (availableImages && !availableImages.has(selected.src))) return {...article, image:null};
    used.add(selected.src);
    return {...article, image:selected};
  });
}

export async function availableImageSources(webRoot, articles = []) {
  const candidates = articles.map(article => normalizeImage(article.image)).filter(Boolean);
  const available = new Set();
  await Promise.all(candidates.map(async ({src,sha256}) => {
    try {
      const stat = await lstat(resolve(webRoot, 'images', src.split('/').pop()));
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 8000000 && createHash('sha256').update(await readFile(resolve(webRoot,'images',src.split('/').pop()))).digest('hex') === sha256) available.add(src);
    } catch { /* Missing or changed images never prevent publication. */ }
  }));
  return available;
}

export function imageHTML(value, {priority = false} = {}) {
  const image = normalizeImage(value);
  if (!image) return '';
  const credit = image.sourceUrl ? `<a href="${esc(image.sourceUrl)}" rel="noopener noreferrer">${esc(image.credit)}</a>` : esc(image.credit);
  const caption = [image.kind === 'graphic' ? 'Document source' : 'Photographie', image.caption].join(' — ');
  return `<figure class="journal-figure"><img data-journal-image src="${esc(image.src)}" alt="${esc(image.alt)}" width="${image.width}" height="${image.height}" loading="${priority ? 'eager' : 'lazy'}" decoding="async"><figcaption><span>${esc(caption)}</span> <small>${credit} · <a href="${esc(image.licenseUrl)}" rel="noopener noreferrer">${esc(image.license)}</a></small></figcaption></figure>`;
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
