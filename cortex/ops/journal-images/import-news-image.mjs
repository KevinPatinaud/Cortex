import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList, isIP} from 'node:net';
import {readFile, writeFile, rename, mkdir, lstat, unlink} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {reference, normalizeImage, validEditionDate} from './journal-images.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const privateNetworks = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) privateNetworks.addSubnet(address,prefix,'ipv4');
privateNetworks.addSubnet('2001:db8::',32,'ipv6');
const publicIPv6 = new BlockList();
publicIPv6.addSubnet('2000::',3,'ipv6');
export function publicAddress(address) {
  if (isIP(address) === 4) return !privateNetworks.check(address,'ipv4');
  return isIP(address) === 6 && publicIPv6.check(address,'ipv6') && !privateNetworks.check(address,'ipv6');
}

export async function downloadImage(value, redirects = 0) {
  const url = new URL(reference(value) || 'https://invalid.invalid/');
  if (!reference(value) || (url.port && url.port !== '443') || redirects > 3) throw new Error('URL d’image HTTPS publique attendue.');
  let timer;
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Résolution DNS trop longue.')),5000);})
  ]).finally(()=>clearTimeout(timer));
  if (!addresses.length || addresses.some(item=>!publicAddress(item.address))) throw new Error('Adresse réseau non publique refusée.');
  // Pin the validated DNS answer for this connection, including every redirect.
  const pinned = addresses[0];
  return new Promise((resolveDownload,reject)=>{
    const req = request(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Cortex-Journal/1.0','Accept':'image/jpeg,image/png,image/webp'},lookup:(_hostname,options,callback)=>callback(null,options.all ? [pinned] : pinned.address, pinned.family)},response=>{
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) return reject(new Error('Redirection sans destination.'));
        downloadImage(new URL(response.headers.location,url).href,redirects+1).then(resolveDownload,reject);
        return;
      }
      const type = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !['image/jpeg','image/png','image/webp'].includes(type)) {
        response.resume();return reject(new Error('La source ne fournit pas une image JPEG, PNG ou WebP accessible.'));
      }
      if (Number(response.headers['content-length']) > 8000000) {response.destroy();return reject(new Error('Image trop lourde (8 Mo maximum).'));}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>8000000) {response.destroy(new Error('Image trop lourde (8 Mo maximum).'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>resolveDownload({bytes:Buffer.concat(chunks),type,downloadUrl:url.href}));
    });
    req.on('error',reject);req.end();
  });
}

// Read dimensions from the original raster bytes; do not crop or retouch news
// photographs, embedded credits, charts or their copyright notices.
export function rasterInfo(bytes) {
  let info;
  if(bytes.length>=67 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR' && bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND') info={type:'image/png',extension:'png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  else if(bytes.length>=30 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' && bytes.readUInt32LE(4)===bytes.length-8) {
    const kind=bytes.toString('ascii',12,16);
    if(kind==='VP8X') info={width:bytes.readUIntLE(24,3)+1,height:bytes.readUIntLE(27,3)+1};
    else if(kind==='VP8 ' && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) info={width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff};
    else if(kind==='VP8L' && bytes[20]===0x2f) {const bits=bytes.readUInt32LE(21);info={width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
    if(info) info={...info,type:'image/webp',extension:'webp'};
  } else if(bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[bytes.length-2]===0xff && bytes[bytes.length-1]===0xd9) {
    let position=2;
    while(position+4<=bytes.length) {
      if(bytes[position++]!==0xff) break;
      while(bytes[position]===0xff) position++;
      const marker=bytes[position++];
      if(marker===0xd9 || marker===0xda) break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(position+2>bytes.length) break;
      const length=bytes.readUInt16BE(position);
      if(length<2 || position+length>bytes.length) break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=8) {info={type:'image/jpeg',extension:'jpg',width:bytes.readUInt16BE(position+5),height:bytes.readUInt16BE(position+3)};break;}
      position+=length;
    }
  }
  if(!info || info.width<100 || info.height<100 || info.width>8000 || info.height>8000 || info.width*info.height>32000000) throw new Error('Image matricielle invalide ou dimensions excessives.');
  return info;
}

async function atomicWrite(path,bytes,{immutable=false}={}) {
  await mkdir(dirname(path),{recursive:true});
  const stat=await lstat(path).catch(error=>{if(error.code==='ENOENT') return null;throw error;});
  if(stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error('Destination d’image invalide.');
  if(stat) {
    const before=await readFile(path);
    if(before.equals(bytes)) return;
    if(immutable) throw new Error('Collision de fichier image.');
  }
  const temporary=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(temporary,bytes,{flag:'wx',mode:0o644});await rename(temporary,path);}
  finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT') throw error;});}
}

export async function importNewsImage(candidate,{journalDirectory,webRoot},{download=downloadImage}={}) {
  if(!validEditionDate(candidate.editionDate) || typeof candidate.articleTitle!=='string' || !candidate.articleTitle.trim() || candidate.articleTitle.length>500 || !reference(candidate.articleSourceUrl) || candidate.visualVerified!==true || candidate.rightsVerified!==true || typeof candidate.relation!=='string' || !candidate.relation.trim() || candidate.relation.length>1500) throw new Error('Date, article, pertinence et vérifications de provenance/droits obligatoires.');
  if ((candidate.sourcePublishedAt != null && !validEditionDate(candidate.sourcePublishedAt)) || (candidate.photoDate != null && !validEditionDate(candidate.photoDate))) throw new Error('Date de source ou de prise de vue invalide.');
  // Validate all editorial fields before contacting a remote server.
  const placeholder='a'.repeat(64);
  if(!normalizeImage({...candidate,origin:candidate.origin,src:`/journal/images/news-${candidate.editionDate}-${placeholder.slice(0,16)}.jpg`,sha256:placeholder,width:100,height:100})) throw new Error('Métadonnées de source, crédit, légende ou droits incomplètes.');
  const {bytes,type,downloadUrl}=await download(candidate.imageUrl);
  if(!Buffer.isBuffer(bytes) || bytes.length>8000000) throw new Error('Image trop lourde ou vide.');
  const info=rasterInfo(bytes);
  if(info.type!==type) throw new Error('Le type déclaré ne correspond pas au fichier.');
  const sha256=hash(bytes), filename=`news-${candidate.editionDate}-${sha256.slice(0,16)}.${info.extension}`;
  const image=normalizeImage({...candidate,src:'/journal/images/'+filename,sha256,width:info.width,height:info.height});
  const record={editionDate:candidate.editionDate,articleTitle:candidate.articleTitle.trim(),articleSourceUrl:candidate.articleSourceUrl,relation:candidate.relation.trim(),sourcePublishedAt:candidate.sourcePublishedAt || null,photoDate:candidate.photoDate || null,downloadUrl,image};
  const recordPath=resolve(journalDirectory,'news-images',candidate.editionDate,hash(record.articleTitle).slice(0,16)+'-'+sha256.slice(0,16)+'.json');
  await atomicWrite(resolve(webRoot,'images',filename),bytes,{immutable:true});
  await atomicWrite(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'));
  return {recordPath,src:image.src,bytes:bytes.length};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), options={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--candidate','--journal-dir','--web-root'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Arguments invalides.');
    options[args[i]]=args[i+1];
  }
  if(!options['--candidate']) throw new Error('Usage : node import-news-image.mjs --candidate FILE.json [--journal-dir DIR] [--web-root DIR]');
  const journalDirectory=resolve(options['--journal-dir'] || dirname(fileURLToPath(import.meta.url)));
  importNewsImage(JSON.parse(await readFile(resolve(options['--candidate']),'utf8')),{journalDirectory,webRoot:resolve(options['--web-root'] || '/var/www/KevinPatinaud/journal')}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
