import { env } from 'cloudflare:workers';
import { MenuError, MAX_MENU_BYTES } from '@/lib/restaurant-media';

export function menuBucket(): R2Bucket {
  const bucket = (env as unknown as {BUCKET?: R2Bucket}).BUCKET;
  if (!bucket) throw new MenuError('图片服务暂时不可用，请稍后重试。',503);
  return bucket;
}
export async function imageBytes(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > MAX_MENU_BYTES) {
    await request.body?.cancel();
    throw new MenuError('每张菜单图片不能超过 5 MB。',413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MenuError('请选择菜单图片。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MENU_BYTES) { await reader.cancel(); throw new MenuError('每张菜单图片不能超过 5 MB。',413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
// Restrict uploads to raster containers; never serve client-supplied HTML/SVG or a client-chosen MIME type.
export function imageType(bytes: Uint8Array): string {
  const match = (offset: number, values: number[]) => values.every((v,i) => bytes[offset+i] === v);
  const text = (offset: number, value: string) => match(offset,Array.from(value,c => c.charCodeAt(0)));
  if (bytes.length >= 45 && match(0,[137,80,78,71,13,10,26,10]) && text(12,'IHDR') && text(bytes.length-8,'IEND')) return 'image/png';
  if (bytes.length >= 4 && match(0,[255,216,255]) && match(bytes.length-2,[255,217])) return 'image/jpeg';
  if (bytes.length >= 20 && text(0,'RIFF') && text(8,'WEBP') && ['VP8 ','VP8L','VP8X'].some(t => text(12,t)) && new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true) === bytes.length-8) return 'image/webp';
  throw new MenuError('图片格式无法识别，请选择 JPG、PNG 或 WebP 菜单图片。',415);
}
