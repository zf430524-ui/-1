import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const allowedTypes = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp']]);
const maxBytes = 5 * 1024 * 1024;

export function createGuideFileService(rootPath) {
  const root = resolve(rootPath);
  mkdirSync(root, { recursive: true });

  function absolutePath(fileRef) {
    const safe = normalize(String(fileRef || '')).replace(/^[/\\]+/, '');
    const path = resolve(root, safe);
    if (!safe || (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`))) throw new Error('INVALID_CONTROLLED_FILE_REF');
    return path;
  }

  function save({ guideId, documentType, mimeType, base64 }) {
    const extension = allowedTypes.get(String(mimeType || '').toLowerCase());
    if (!extension) throw Object.assign(new Error('证件图片仅支持 PNG、JPG 或 WebP'), { code: 'DOCUMENT_FILE_TYPE_INVALID' });
    const encoded = String(base64 || '').trim();
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Object.assign(new Error('证件图片内容无效'), { code: 'DOCUMENT_FILE_INVALID' });
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > maxBytes) throw Object.assign(new Error('证件图片不能为空且不能超过 5 MB'), { code: 'DOCUMENT_FILE_SIZE_INVALID' });
    const validSignature = extension === '.png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : extension === '.jpg' ? buffer[0] === 0xff && buffer[1] === 0xd8
        : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!validSignature) throw Object.assign(new Error('证件图片内容与文件类型不一致'), { code: 'DOCUMENT_FILE_INVALID' });
    const folder = String(guideId).replace(/[^A-Za-z0-9_-]/g, '_');
    const label = documentType === '身份证正面' ? 'id-front' : documentType === '身份证反面' ? 'id-back' : 'guide-license';
    const fileRef = `${folder}/${label}-${randomBytes(8).toString('hex')}${extension}`;
    const path = absolutePath(fileRef);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp-${randomBytes(6).toString('hex')}`;
    try { writeFileSync(temporaryPath, buffer, { flag: 'wx' }); renameSync(temporaryPath, path); }
    catch (error) { rmSync(temporaryPath, { force: true }); throw error; }
    return { fileRef: fileRef.replace(/\\/g, '/'), byteLength: buffer.length };
  }

  function read(fileRef) {
    const path = absolutePath(fileRef);
    const extension = extname(path).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return { mimeType, buffer: readFileSync(path) };
  }

  function remove(fileRef) {
    if (!fileRef) return;
    rmSync(absolutePath(fileRef), { force: true });
  }

  return Object.freeze({ save, read, remove, maxBytes, allowedMimeTypes: [...allowedTypes.keys()] });
}
