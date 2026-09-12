import { database } from '@/lib/game-db';
import { seeds } from '@/lib/seeds';
import type { Restaurant, Room, Vote, FoodOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';
class UserError extends Error { constructor(message: string, public status = 400) { super(message); } }
function clean(value: unknown, max: number, label: string, required = true) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; throw new UserError(`请填写${label}`); }
  const text = value.normalize('NFKC').trim();
  if ((required && !text) || text.length > max) throw new UserError(`${label}请填写 1–${max} 个字`);
  return text;
}
function randomIndex(n: number) {
  const limit = Math.floor(4294967296 / n) * n;
  let r: number;
  do { r = crypto.getRandomValues(new Uint32Array(1))[0]; } while (r >= limit);
  return r % n;
}
async function identity(request: Request) {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)fd_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const token = cookie || Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2,'0')).join('');
  const owner = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), x => x.toString(16).padStart(2,'0')).join('');
  return { owner, cookie: cookie ? null : `fd_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` };
}
async function seed(db: D1Database, owner: string) {
  const existing = await db.prepare('SELECT id FROM restaurants WHERE owner = ? LIMIT 1').bind(owner).first();
  if (!existing) await db.batch(seeds.map((s,i) => db.prepare('INSERT OR IGNORE INTO restaurants (id,owner,name,cuisine,address,source,selected,position) VALUES (?,?,?,?,?,?,1,?)').bind(`${owner.slice(0,24)}-${i}`,owner,s.name,s.cuisine,s.address,s.source,i)));
}
async function catalog(db: D1Database, owner: string) {
  await seed(db,'shared');
  const [restaurants,rooms] = await db.batch([
    db.prepare('SELECT id,name,cuisine,address,source,selected,position FROM restaurants WHERE owner=? AND deleted=0 ORDER BY position,id').bind('shared'),
    db.prepare('SELECT id,title,status FROM rooms WHERE owner=? ORDER BY created_at DESC LIMIT 8').bind(owner),
  ]);
  return { restaurants:restaurants.results, rooms:rooms.results };
}
async function roomState(db: D1Database, id: string, owner: string): Promise<Room> {
  const [roomRows,candidates,votes,myVote,orders] = await db.batch([
    db.prepare('SELECT * FROM rooms WHERE id=?').bind(id),
    db.prepare('SELECT c.id,c.name,c.cuisine,c.address,c.source,c.position,COUNT(v.id) AS count FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY c.position').bind(id),
    db.prepare('SELECT nickname,candidate_id,created_at FROM votes WHERE room_id=? ORDER BY created_at DESC').bind(id),
    db.prepare('SELECT nickname,candidate_id,created_at FROM votes WHERE room_id=? AND voter=?').bind(id,owner),
    db.prepare('SELECT * FROM orders WHERE room_id=? ORDER BY created_at,id').bind(id),
  ]);
  const room=roomRows.results[0] as {id:string;title:string;status:string;winner_id:string|null;created_at:string;revision:number;owner:string}|undefined;
  if (!room) throw new UserError('找不到这轮投票，请检查群里的链接。',404);
  return { id:room.id,title:room.title,status:room.status,winner_id:room.winner_id,created_at:room.created_at,revision:room.revision,isHost:room.owner===owner,candidates:candidates.results as Restaurant[],votes:votes.results as Vote[],myVote:myVote.results[0] as Vote||null,total:votes.results.length,orders:(orders.results as (FoodOrder & {owner:string;claimant:string|null})[]).map(o=>({id:o.id,nickname:o.nickname,dish:o.dish,quantity:o.quantity,note:o.note,status:o.status,claimant_name:o.claimant_name,created_at:o.created_at,isMine:o.owner===owner,canManage:o.claimant===owner||room.owner===owner})) };
}
async function handle(request: Request) {
  let cookie: string | null = null;
  try {
    const identityResult = await identity(request); cookie=identityResult.cookie;
    const owner=identityResult.owner, db=database(), url=new URL(request.url);
    let result: unknown;
    if (request.method === 'GET') {
      const room=url.searchParams.get('room');
      result=room ? await roomState(db,clean(room,64,'投票编号'),owner) : await catalog(db,owner);
    } else {
      const origin=request.headers.get('origin');
      if (origin && origin!==url.origin) throw new UserError('请在投票页面内操作。',403);
      const raw=await request.text();
      if (raw.length>16384) throw new UserError('提交内容过长。',413);
      let body: Record<string,unknown>;
      try { body=JSON.parse(raw); } catch { throw new UserError('提交内容无效。'); }
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new UserError('提交内容无效。');
      if (body.action==='saveRestaurant') {
        await seed(db,'shared');
        const name=clean(body.name,60,'餐馆名称'), cuisine=clean(body.cuisine,40,'餐馆类型',false),address=clean(body.address,160,'地址',false);
        if (body.id) {
          const id=clean(body.id,80,'餐馆编号');
          const changed=await db.prepare('UPDATE restaurants SET name=?,cuisine=?,address=?,source=CASE WHEN name=? AND address=? THEN source ELSE \'\' END WHERE id=? AND owner=? AND deleted=0').bind(name,cuisine,address,name,address,id,'shared').run();
          if (!changed.meta.changes) throw new UserError('餐馆不存在。',404);
        } else {
          const added=await db.prepare('INSERT INTO restaurants (id,owner,name,cuisine,address,source,selected,position) SELECT ?,?,?,?,?,\'\',1,? WHERE (SELECT COUNT(*) FROM restaurants WHERE owner=\'shared\' AND deleted=0)<100').bind(crypto.randomUUID(),'shared',name,cuisine,address,Date.now()).run();
          if(!added.meta.changes) throw new UserError('餐馆库最多保存 100 家餐馆。');
        }
        result=await catalog(db,owner);
      } else if (body.action==='deleteRestaurant' || body.action==='restoreRestaurant') {
        const id=clean(body.id,80,'餐馆编号');
        const existing=await db.prepare('SELECT id FROM restaurants WHERE id=? AND owner=\'shared\'').bind(id).first();
        if(!existing) throw new UserError('餐馆不存在。',404);
        if(body.action==='deleteRestaurant') {
          // Keep the row as a tombstone: an empty catalog must not regenerate the initial seeds.
          await db.prepare('UPDATE restaurants SET deleted=1 WHERE id=? AND owner=\'shared\'').bind(id).run();
        } else {
          const restored=await db.prepare('UPDATE restaurants SET deleted=0 WHERE id=? AND owner=\'shared\' AND (deleted=0 OR (SELECT COUNT(*) FROM restaurants WHERE owner=\'shared\' AND deleted=0)<100)').bind(id).run();
          if(!restored.meta.changes) throw new UserError('餐馆库已满 100 家，请先删除一家再撤销。',409);
        }
        result=await catalog(db,owner);
      } else if (body.action==='create') {
        await seed(db,'shared');
        const title=clean(body.title,60,'投票名称');
        if(!Array.isArray(body.restaurantIds)||body.restaurantIds.length<2||body.restaurantIds.length>100) throw new UserError('请选择 2–100 家候选餐馆。');
        const ids=[...new Set(body.restaurantIds.map(id=>clean(id,80,'餐馆编号')))];
        const rows=(await db.prepare(`SELECT * FROM restaurants WHERE owner='shared' AND deleted=0 AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY position,id`).bind(...ids).all<Restaurant>()).results;
        if(rows.length!==ids.length||rows.length<2) throw new UserError('候选名单已变化，请刷新后重新选择。');
        const id=crypto.randomUUID().replaceAll('-','');
        await db.batch([
          db.prepare('INSERT INTO rooms (id,owner,title,status,created_at) VALUES (?,?,?,\'open\',?)').bind(id,owner,title,new Date().toISOString()),
          ...rows.map((r,i)=>db.prepare('INSERT INTO candidates (id,room_id,name,cuisine,address,source,position) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,r.name,r.cuisine,r.address,r.source,i+1)),
        ]);
        result=await roomState(db,id,owner);
      } else if (body.action==='vote') {
        const id=clean(body.room,64,'投票编号'),nickname=clean(body.nickname,24,'群昵称');
        const room=await roomState(db,id,owner);
        if (room.myVote) result=room;
        else {
          if(room.status!=='open') throw new UserError('这轮已结束，不能再投票。',409);
          if(room.total>=200) throw new UserError('本轮已达到 200 人。');
          const picked=room.candidates[randomIndex(room.candidates.length)] as {id:string};
          try {
            await db.batch([
              db.prepare('INSERT INTO votes (id,room_id,voter,nickname,nickname_key,candidate_id,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND status=\'open\') AND (SELECT COUNT(*) FROM votes WHERE room_id=?)<200').bind(crypto.randomUUID(),id,owner,nickname,nickname.toLocaleLowerCase(),picked.id,new Date().toISOString(),id,id),
              db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').bind(id),
            ]);
          } catch (e) {
            if(String(e).includes('UNIQUE')) {
              const current=await roomState(db,id,owner);
              if(!current.myVote) throw new UserError('这个昵称已经投过票了，请使用你自己的群昵称。',409);
            } else throw e;
          }
          result=await roomState(db,id,owner);
          if(!(result as {myVote:unknown}).myVote) throw new UserError('本轮刚刚结束或已满 200 人，这一票没有计入。',409);
        }
      } else if (body.action==='close') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(!room.isHost) throw new UserError('只有发起人可以结束本轮。',403);
        if(!room.total) throw new UserError('至少收到一票后才能结束。');
        // Winner selection and closing are one atomic statement. Votes can no longer enter afterward.
        await db.prepare('UPDATE rooms SET status=\'closed\',revision=revision+1,winner_id=(SELECT c.id FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY COUNT(v.id) DESC,random() LIMIT 1) WHERE id=? AND owner=? AND status=\'open\'').bind(id,id,owner).run();
        result=await roomState(db,id,owner);
      } else if (body.action==='order' || body.action==='claim' || body.action==='deliver' || body.action==='release' || body.action==='cancelOrder') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(room.status!=='closed') throw new UserError('餐馆确定后才能登记带饭。',409);
        let statement: D1PreparedStatement;
        if(body.action==='order') {
          const nickname=clean(body.nickname,24,'群昵称'),dish=clean(body.dish,100,'菜名'),note=clean(body.note,240,'备注',false);
          const quantity=body.quantity;
          if(typeof quantity!=='number'||!Number.isInteger(quantity)||quantity<1||quantity>20) throw new UserError('份数请填写 1–20。');
          const orderId=clean(body.orderId,64,'登记编号');
          if(!/^[a-f0-9-]{36}$/.test(orderId)) throw new UserError('登记编号无效。');
          // A client-generated request ID makes retrying a submitted order safe.
          statement=db.prepare('INSERT OR IGNORE INTO orders (id,room_id,owner,nickname,dish,quantity,note,status,created_at) SELECT ?,?,?,?,?,?,?,\'pending\',? WHERE (SELECT COUNT(*) FROM orders WHERE room_id=?)<200').bind(orderId,id,owner,nickname,dish,quantity,note,new Date().toISOString(),id);
        } else {
          const orderId=clean(body.orderId,64,'带饭编号');
          const order=room.orders.find(o=>o.id===orderId);
          if(!order) throw new UserError('这条带饭登记已取消，请刷新。',404);
          if(body.action==='claim') {
            const name=clean(body.nickname,24,'带饭人的群昵称');
            statement=db.prepare('UPDATE orders SET status=\'claimed\',claimant=?,claimant_name=? WHERE id=? AND room_id=? AND status=\'pending\'').bind(owner,name,orderId,id);
          } else if(body.action==='cancelOrder') {
            if(!order.isMine) throw new UserError('只能取消自己的带饭登记。',403);
            if(order.status!=='pending') throw new UserError('已有朋友认领，请在群里联系带饭人。',409);
            statement=db.prepare('DELETE FROM orders WHERE id=? AND room_id=? AND owner=? AND status=\'pending\'').bind(orderId,id,owner);
          } else {
            if(!order.canManage) throw new UserError('只有带饭人或本轮发起人可以操作。',403);
            statement=body.action==='deliver' ? db.prepare('UPDATE orders SET status=\'delivered\' WHERE id=? AND room_id=? AND status=\'claimed\' AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?))').bind(orderId,id,owner,id,owner) : db.prepare('UPDATE orders SET status=\'pending\',claimant=NULL,claimant_name=NULL WHERE id=? AND room_id=? AND status=\'claimed\' AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?))').bind(orderId,id,owner,id,owner);
          }
        }
        const changed=await db.batch([statement,db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').bind(id)]);
        if(!changed[0].meta.changes) {
          if(body.action==='order') {
            const existing=await db.prepare('SELECT id FROM orders WHERE id=? AND room_id=? AND owner=?').bind(body.orderId as string,id,owner).first();
            if(!existing) throw new UserError('本轮带饭清单已满，请在群里联系发起人。',409);
          } else throw new UserError('这条登记刚被更新，请查看最新清单。',409);
        }
        result=await roomState(db,id,owner);
      } else throw new UserError('未知操作。');
    }
    const headers: Record<string,string>={'Cache-Control':'no-store'};
    if(cookie) headers['Set-Cookie']=cookie;
    return Response.json(result,{headers});
  } catch(error) {
    if(!(error instanceof UserError)) console.error('Fandian request failed',error);
    const headers: Record<string,string>={'Cache-Control':'no-store'}; if(cookie) headers['Set-Cookie']=cookie;
    return Response.json({error:error instanceof UserError ? error.message : '暂时连接不上，请稍后重试。你的填写内容仍然保留。'},{status:error instanceof UserError ? error.status : 503,headers});
  }
}
export const GET=handle;
export const POST=handle;
