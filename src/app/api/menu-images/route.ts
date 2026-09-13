import { database } from '@/lib/game-db';
import { visitorIdentity } from '@/lib/visitor-identity';
import { MenuError, MENU_TYPES } from '@/lib/restaurant-media';
import { menuBucket, imageBytes, imageType } from '@/lib/menu-storage';

export const dynamic = 'force-dynamic';
type Asset = {id:string; owner:string; content_type:string; content_hash:string; size:number; ready:number; published:number};
const key = (id: string) => `menus/${id}`;
async function hash(value: string | Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value === 'string' ? new TextEncoder().encode(value) : value as Uint8Array<ArrayBuffer>)), b=>b.toString(16).padStart(2,'0')).join('');
}
async function handle(request: Request) {
  const headers: Record<string,string> = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try {
    const url = new URL(request.url), db = database();
    if (request.method === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (!/^[a-f0-9]{32}$/.test(id)) throw new MenuError('找不到这张菜单图片。',404);
      const asset = await db.prepare('SELECT * FROM menu_images WHERE id=? AND ready=1').bind(id).first<Asset>();
      if (!asset) throw new MenuError('找不到这张菜单图片。',404);
      if (!asset.published) {
        const viewer = await visitorIdentity(request,db);
        if (viewer.owner !== asset.owner) throw new MenuError('找不到这张菜单图片。',404);
      }
      const object = await menuBucket().get(key(id));
      if (!object) throw new MenuError('菜单图片暂时无法加载，请稍后重试。',503);
      return new Response(object.body, {headers:{...headers,'Content-Type':asset.content_type,'Content-Length':String(asset.size),'Content-Disposition':'inline','Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new MenuError('请在餐馆编辑页面上传图片。',403);
    const viewer = await visitorIdentity(request,db);
    if (viewer.cookie) headers['Set-Cookie'] = viewer.cookie;
    headers['X-Fandian-Identity'] = viewer.viewKey;
    const expected = request.headers.get('x-fandian-identity');
    if ((expected && expected !== viewer.viewKey) || (!expected && viewer.account.signed_in)) return Response.json({error:'登录身份已变化，请刷新页面后再上传。',code:'AUTH_CHANGED'},{status:409,headers});
    const requestId = url.searchParams.get('request') || '';
    if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new MenuError('上传请求无效，请重新选择图片。');
    const declared = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!MENU_TYPES.includes(declared)) throw new MenuError('请上传 JPG、PNG 或 WebP 图片。',415);
    const bytes = await imageBytes(request), type = imageType(bytes);
    if (type !== declared) throw new MenuError('图片内容与格式不一致，请重新导出图片再上传。',415);
    const bucket = menuBucket();
    // Delete stale, unattached reservations atomically before their objects. Saving a restaurant
    // checks readiness in its own transaction, so expired drafts cannot become broken references.
    const expired = await db.prepare("DELETE FROM menu_images WHERE id IN (SELECT id FROM menu_images WHERE published=0 AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') LIMIT 50) RETURNING id").all<{id:string}>();
    if (expired.results.length) await bucket.delete(expired.results.map(a=>key(a.id)));
    const id = (await hash(`menu:${viewer.owner}:${requestId}`)).slice(0,32), digest = await hash(bytes);
    await db.prepare(`INSERT OR IGNORE INTO menu_images (id,owner,content_type,size,content_hash,created_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM menu_images WHERE owner=? AND published=0)<12
      AND (SELECT COUNT(*) FROM menu_images WHERE owner=? AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<40`)
      .bind(id,viewer.owner,type,bytes.length,digest,new Date().toISOString(),viewer.owner,viewer.owner).run();
    const asset = await db.prepare('SELECT * FROM menu_images WHERE id=?').bind(id).first<Asset>();
    if (!asset) throw new MenuError('今天上传的图片较多，请先保存已上传的菜单，或明天再试。',429);
    if (asset.content_hash !== digest || asset.content_type !== type) throw new MenuError('重试图片与上次不同，请重新选择图片。',409);
    if (!asset.ready) {
      await bucket.put(key(id),bytes,{httpMetadata:{contentType:type}});
      await db.prepare('UPDATE menu_images SET ready=1 WHERE id=?').bind(id).run();
    }
    return Response.json({id},{headers});
  } catch (error) {
    if (!(error instanceof MenuError)) console.error('Menu image request failed',error);
    return Response.json({error:error instanceof MenuError ? error.message : '菜单图片暂时无法保存或加载，请稍后重试。'},{status:error instanceof MenuError ? error.status : 503,headers});
  }
}
export const GET = handle;
export const POST = handle;
