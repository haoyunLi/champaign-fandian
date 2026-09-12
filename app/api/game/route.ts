import { database } from '@/lib/game-db';
import { seeds } from '@/lib/seeds';
import { ACTIVE_DELIVERY_SQL, finishMeal, mealLifecycle, settleMeals, type LifecycleRow } from '@/lib/meal-lifecycle';
import type { Restaurant, Room, Vote, FoodOrder, HistoryRoom, HistoryPage, HomeMeal, VotingMode } from '@/lib/types';

export const dynamic = 'force-dynamic';
class UserError extends Error { constructor(message: string, public status = 400, public code?: string, public room?: Room) { super(message); } }
function foodRetryAccepted(room: Room, action: unknown, orderId: string, expectedRevision?: unknown) {
  const existing=room.orders.find(order=>order.id===orderId);
  return (action==='order' && existing?.isMine) || (action==='deliver' && existing?.status==='delivered' && existing.canManage && Number.isInteger(expectedRevision) && existing.revision===(expectedRevision as number)+1);
}
async function hashText(value: string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
function mealFinishedError(room: Room) {
  return new UserError(room.completion_reason==='delivered' ? '带饭已全部带回，本轮已结束。' : '确定餐馆已满 12 小时，本轮已自动结束。',409);
}
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
  await backfillHistory(db,owner);
  const visibleFrom=`FROM rooms r LEFT JOIN room_history h ON h.room_id=r.id AND h.owner=?
    WHERE r.deleted_at IS NULL AND (r.owner=? OR (h.room_id IS NOT NULL AND h.hidden_at IS NULL))`;
  const activeFrom=`${visibleFrom} AND (r.status='open' OR (r.status='closed' AND r.completed_at IS NULL))`;
  const summarySelect=`SELECT r.id,r.title,r.status,r.mode,r.created_at,r.deleted_at,r.decided_at,r.completed_at,r.completion_reason,r.orders_stopped_at,
    r.owner=? AS isHost,(SELECT name FROM candidates WHERE id=r.winner_id AND room_id=r.id) AS winner_name,
    (SELECT COUNT(*) FROM votes WHERE room_id=r.id) AS vote_count,(SELECT COUNT(*) FROM orders WHERE room_id=r.id) AS order_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='pending') AS pending_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='claimed') AS claimed_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='delivered') AS delivered_count`;
  const [,,restaurants,rooms,active,total,finished] = await db.batch([
    ...settleMeals(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]),
    db.prepare('SELECT id,name,cuisine,address,source,selected,position FROM restaurants WHERE owner=? AND deleted=0 ORDER BY position,id').bind('shared'),
    db.prepare('SELECT id,title,status,mode,created_at,decided_at,completed_at,completion_reason FROM rooms WHERE owner=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 8').bind(owner),
    db.prepare(`${summarySelect} ${activeFrom} ORDER BY r.created_at DESC,r.id DESC LIMIT 8`).bind(owner,owner,owner),
    db.prepare(`SELECT COUNT(*) AS count ${activeFrom}`).bind(owner,owner),
    db.prepare(`${summarySelect} ${visibleFrom} AND r.status='closed'
      AND r.completed_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
      AND EXISTS (SELECT 1 FROM orders WHERE room_id=r.id)
      ORDER BY r.completed_at DESC,r.id DESC LIMIT 4`).bind(owner,owner,owner),
  ]);
  return { restaurants:restaurants.results,
    rooms:(rooms.results as (LifecycleRow & {id:string;title:string;mode:VotingMode})[]).map(row=>({...row,...mealLifecycle(row)})),
    activeRooms:(active.results as HomeMeal[]).map(row=>({...row,...mealLifecycle(row),isHost:!!row.isHost})),
    recentFinishedRooms:(finished.results as HomeMeal[]).map(row=>({...row,...mealLifecycle(row),isHost:!!row.isHost})),
    activeRoomCount:Number((total.results[0] as {count:number}|undefined)?.count || 0) };
}
async function backfillHistory(db: D1Database, owner: string) {
  // Import earlier participation without resurrecting entries the visitor removed.
  await db.prepare(`INSERT OR IGNORE INTO room_history (owner,room_id,created_at)
    SELECT ?,activity.room_id,MIN(activity.created_at) FROM (
      SELECT room_id,created_at FROM votes WHERE voter=?
      UNION ALL SELECT room_id,created_at FROM orders WHERE owner=?
      UNION ALL SELECT room_id,created_at FROM orders WHERE claimant=?
    ) activity JOIN rooms r ON r.id=activity.room_id WHERE r.owner<>? GROUP BY activity.room_id`).bind(owner,owner,owner,owner,owner).run();
}
function recordParticipation(db: D1Database, id: string, owner: string) {
  // Run in the action's transaction: only an actual vote, order or claim records a visit.
  return db.prepare(`INSERT OR IGNORE INTO room_history (owner,room_id,created_at)
    SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner<>? AND deleted_at IS NULL)
    AND (EXISTS (SELECT 1 FROM votes WHERE room_id=? AND voter=?)
      OR EXISTS (SELECT 1 FROM orders WHERE room_id=? AND (owner=? OR claimant=?)))`)
    .bind(owner,id,new Date().toISOString(),id,owner,id,owner,id,owner,owner);
}
async function historyPage(db: D1Database, owner: string, url: URL): Promise<HistoryPage> {
  const trash = url.searchParams.get('history') === 'trash';
  const scope=url.searchParams.get('scope') || 'all';
  if(!['all','hosted','joined'].includes(scope)) throw new UserError('历史记录分类无效。');
  const cursorText = url.searchParams.get('cursor');
  let cursor: { createdAt: string; id: string } | null = null;
  if (cursorText) {
    try {
      const value = JSON.parse(cursorText);
      if (!value || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)) throw new Error();
      cursor = value;
    } catch { throw new UserError('历史记录页码无效，请重新打开历史记录。'); }
  }
  await backfillHistory(db,owner);
  await db.batch(settleMeals(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]));
  const rows = (await db.prepare(`WITH viewer AS (SELECT ? AS owner)
    SELECT r.id,r.title,r.status,r.mode,r.created_at,r.decided_at,r.completed_at,r.completion_reason,
    CASE WHEN r.owner=viewer.owner THEN r.deleted_at ELSE h.hidden_at END AS deleted_at,
    r.owner=viewer.owner AS isHost,c.name AS winner_name,
    (SELECT COUNT(*) FROM votes v WHERE v.room_id=r.id) AS vote_count,
    (SELECT COUNT(*) FROM orders o WHERE o.room_id=r.id) AS order_count
    FROM rooms r CROSS JOIN viewer
    LEFT JOIN room_history h ON h.room_id=r.id AND h.owner=viewer.owner
    LEFT JOIN candidates c ON c.id=r.winner_id AND c.room_id=r.id
    WHERE ${trash
      ? '((r.owner=viewer.owner AND r.deleted_at IS NOT NULL) OR (r.owner<>viewer.owner AND r.deleted_at IS NULL AND h.hidden_at IS NOT NULL))'
      : 'r.deleted_at IS NULL AND (r.owner=viewer.owner OR (h.room_id IS NOT NULL AND h.hidden_at IS NULL))'}
    ${scope==='hosted' ? 'AND r.owner=viewer.owner' : scope==='joined' ? 'AND r.owner<>viewer.owner' : ''}
    ${cursor ? 'AND (r.created_at<? OR (r.created_at=? AND r.id<?))' : ''}
    ORDER BY r.created_at DESC,r.id DESC LIMIT 21`).bind(owner, ...(cursor ? [cursor.createdAt,cursor.createdAt,cursor.id] : [])).all<HistoryRoom>()).results;
  const rooms = rows.slice(0,20).map(row=>({...row,...mealLifecycle(row),isHost:!!row.isHost})), last = rooms.at(-1);
  return { rooms, nextCursor: rows.length > 20 && last ? JSON.stringify({createdAt:last.created_at,id:last.id}) : null };
}
async function roomState(db: D1Database, id: string, owner: string): Promise<Room> {
  const [,,roomRows,candidates,votes,myVote,orders,history,preferences] = await db.batch([
    ...settleMeals(db,'id=?',[id]),
    db.prepare('SELECT * FROM rooms WHERE id=? AND deleted_at IS NULL').bind(id),
    db.prepare('SELECT c.id,c.name,c.cuisine,c.address,c.source,c.position,COUNT(v.id) AS count FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY c.position').bind(id),
    db.prepare('SELECT nickname,candidate_id,created_at FROM votes WHERE room_id=? ORDER BY created_at DESC').bind(id),
    db.prepare('SELECT nickname,candidate_id,created_at FROM votes WHERE room_id=? AND voter=?').bind(id,owner),
    db.prepare('SELECT * FROM orders WHERE room_id=? ORDER BY created_at,id').bind(id),
    db.prepare('SELECT hidden_at FROM room_history WHERE owner=? AND room_id=?').bind(owner,id),
    db.prepare('SELECT nickname FROM visitor_preferences WHERE owner=?').bind(owner),
  ]);
  const room=roomRows.results[0] as (LifecycleRow & {id:string;title:string;status:string;mode:VotingMode;winner_id:string|null;created_at:string;revision:number;owner:string;orders_stopped_at:string|null})|undefined;
  if (!room) throw new UserError('这轮投票不存在或已被发起人删除。发起人可在历史记录的回收站中恢复。',404);
  const personalHistory=history.results[0] as {hidden_at:string|null}|undefined;
  const participated=myVote.results.length>0 || (orders.results as {owner:string;claimant:string|null}[]).some(o=>o.owner===owner||o.claimant===owner);
  return { ...mealLifecycle(room),orders_stopped_at:room.orders_stopped_at,canStopOrders:room.owner===owner || (orders.results as {status:string;claimant:string|null}[]).some(o=>o.status==='claimed'&&o.claimant===owner),preferred_nickname:String((preferences.results[0] as {nickname:string}|undefined)?.nickname || ''),id:room.id,title:room.title,status:room.status,mode:room.mode,winner_id:room.winner_id,created_at:room.created_at,revision:room.revision,isHost:room.owner===owner,inHistory:room.owner===owner || (personalHistory ? personalHistory.hidden_at===null : participated),candidates:candidates.results as Restaurant[],votes:votes.results as Vote[],myVote:myVote.results[0] as Vote||null,total:votes.results.length,orders:(orders.results as (FoodOrder & {owner:string;claimant:string|null})[]).map(o=>({id:o.id,nickname:o.nickname,dish:o.dish,quantity:o.quantity,note:o.note,status:o.status,revision:o.revision,isCarrier:o.claimant===owner,claimant_name:o.claimant_name,created_at:o.created_at,isMine:o.owner===owner,canManage:o.claimant===owner||room.owner===owner})) };
}
async function handle(request: Request) {
  let cookie: string | null = null;
  try {
    const identityResult = await identity(request); cookie=identityResult.cookie;
    const owner=identityResult.owner, db=database(), url=new URL(request.url);
    let result: unknown;
    if (request.method === 'GET') {
      const room=url.searchParams.get('room');
      result=room ? await roomState(db,clean(room,64,'投票编号'),owner) : url.searchParams.has('history') ? await historyPage(db,owner,url) : await catalog(db,owner);
    } else {
      const origin=request.headers.get('origin');
      if (origin && origin!==url.origin) throw new UserError('请在投票页面内操作。',403);
      const raw=await request.text();
      if (raw.length>16384) throw new UserError('提交内容过长。',413);
      let body: Record<string,unknown>;
      try { body=JSON.parse(raw); } catch { throw new UserError('提交内容无效。'); }
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new UserError('提交内容无效。');
      if (body.action==='saveHistory') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(!room.isHost) await db.batch([
          db.prepare(`INSERT INTO room_history (owner,room_id,created_at) SELECT ?,?,?
            WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND deleted_at IS NULL AND owner<>?)
            ON CONFLICT(owner,room_id) DO UPDATE SET hidden_at=NULL`).bind(owner,id,new Date().toISOString(),id,owner),
          db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND deleted_at IS NULL').bind(id),
        ]);
        result=await roomState(db,id,owner);
      } else if (body.action==='removeHistory' || body.action==='restoreHistory') {
        const id=clean(body.room,64,'投票编号');
        await backfillHistory(db,owner);
        const changed=await db.batch([
          db.prepare(`UPDATE room_history SET hidden_at=? WHERE owner=? AND room_id=?
            AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner<>? AND deleted_at IS NULL)`)
            .bind(body.action==='removeHistory' ? new Date().toISOString() : null,owner,id,id,owner),
          db.prepare(`UPDATE rooms SET revision=revision+1 WHERE id=? AND owner<>? AND deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM room_history WHERE owner=? AND room_id=?)`).bind(id,owner,owner,id),
        ]);
        if(!changed[0].meta.changes) throw new UserError('记录不存在或投票已被发起人删除，无法操作。',404);
        result={ok:true};
      } else if (body.action==='deleteRoom' || body.action==='restoreRoom') {
        const id=clean(body.room,64,'投票编号');
        const owned=await db.prepare('SELECT id FROM rooms WHERE id=? AND owner=?').bind(id,owner).first();
        if(!owned) throw new UserError('找不到你发起的这轮投票。请使用发起时的浏览器操作。',404);
        if(body.action==='deleteRoom') {
          await db.prepare('UPDATE rooms SET deleted_at=?,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NULL').bind(new Date().toISOString(),id,owner).run();
        } else {
          await db.prepare('UPDATE rooms SET deleted_at=NULL,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NOT NULL').bind(id,owner).run();
        }
        result={ok:true};
      } else if (body.action==='saveRestaurant') {
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
        const title=clean(body.title,60,'投票名称');
        const mode=body.mode === undefined ? 'random' : body.mode;
        if(mode!=='random' && mode!=='manual') throw new UserError('请选择自主投票或随机抽签。');
        if(!Array.isArray(body.restaurantIds)||body.restaurantIds.length<2||body.restaurantIds.length>100) throw new UserError('请选择 2–100 家候选餐馆。');
        const ids=[...new Set(body.restaurantIds.map(id=>clean(id,80,'餐馆编号')))].sort();
        if(ids.length<2) throw new UserError('请选择至少两家不同的餐馆。');
        if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(body.requestId)) throw new UserError('页面已更新，请刷新后重新创建。');
        const id=(await hashText(`create:${owner}:${body.requestId}`)).slice(0,32);
        const requestHash=await hashText(JSON.stringify({title,mode,restaurantIds:ids}));
        const existing=await db.prepare('SELECT creation_request_hash FROM rooms WHERE id=? AND owner=?').bind(id,owner).first<{creation_request_hash:string|null}>();
        if(!existing) {
          await seed(db,'shared');
          const rows=(await db.prepare(`SELECT * FROM restaurants WHERE owner='shared' AND deleted=0 AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY position,id`).bind(...ids).all<Restaurant>()).results;
          if(rows.length!==ids.length) throw new UserError('候选名单已变化，请刷新后重新选择。');
          // The room and its complete candidate snapshot commit together. Retry IDs are stable.
          await db.batch([
            db.prepare("INSERT OR IGNORE INTO rooms (id,owner,title,status,created_at,mode,creation_request_hash) VALUES (?,?,?,'open',?,?,?)").bind(id,owner,title,new Date().toISOString(),mode,requestHash),
            ...rows.map((r,i)=>db.prepare(`INSERT OR IGNORE INTO candidates (id,room_id,name,cuisine,address,source,position)
              SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=? AND creation_request_hash=?)`)
              .bind(`${id}-${i+1}`,id,r.name,r.cuisine,r.address,r.source,i+1,id,owner,requestHash)),
          ]);
        }
        const saved=existing || await db.prepare('SELECT creation_request_hash FROM rooms WHERE id=? AND owner=?').bind(id,owner).first<{creation_request_hash:string|null}>();
        if(saved?.creation_request_hash!==requestHash) throw new UserError('这次创建请求的内容已变化，请刷新后再创建新饭局。',409);
        result=await roomState(db,id,owner);
      } else if (body.action==='replay') {
        const sourceId=clean(body.room,64,'原投票编号'), requestId=clean(body.requestId,36,'请求编号');
        if(!/^[a-f0-9-]{36}$/.test(requestId)) throw new UserError('请求编号无效。');
        // A viewer-scoped deterministic ID gives retries the same room without copying votes or orders.
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`replay:${owner}:${sourceId}:${requestId}`));
        const id=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
        const existing=await db.prepare('SELECT id FROM rooms WHERE id=? AND owner=?').bind(id,owner).first();
        if(!existing) {
          await roomState(db,sourceId,owner);
          await db.batch([
            db.prepare(`INSERT OR IGNORE INTO rooms (id,owner,title,status,created_at,mode)
              SELECT ?,?,title,'open',?,mode FROM rooms WHERE id=? AND deleted_at IS NULL`).bind(id,owner,new Date().toISOString(),sourceId),
            db.prepare(`INSERT OR IGNORE INTO candidates (id,room_id,name,cuisine,address,source,position)
              SELECT ? || '-' || c.position,?,c.name,c.cuisine,c.address,c.source,c.position FROM candidates c
              JOIN rooms original ON original.id=c.room_id
              WHERE c.room_id=? AND original.deleted_at IS NULL AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=?)`).bind(id,id,sourceId,id,owner),
          ]);
        }
        result=await roomState(db,id,owner);
      } else if (body.action==='vote') {
        const id=clean(body.room,64,'投票编号'),nickname=clean(body.nickname,24,'群昵称');
        const room=await roomState(db,id,owner);
        if (room.myVote) result=room;
        else {
          if(room.status!=='open') throw new UserError('投票已截止，餐馆已确定，不能再投票。',409);
          if(room.total>=200) throw new UserError('本轮已达到 200 人。');
          // The room's saved mode controls voting; a submitted mode cannot override it.
          const picked=room.mode==='manual'
            ? room.candidates.find(candidate=>candidate.id===clean(body.candidateId,64,'想投票的餐馆'))
            : room.candidates[randomIndex(room.candidates.length)];
          if(!picked) throw new UserError('请选择本轮候选名单中的一家餐馆。');
          try {
            await db.batch([
              db.prepare('INSERT INTO votes (id,room_id,voter,nickname,nickname_key,candidate_id,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND status=\'open\' AND deleted_at IS NULL) AND (SELECT COUNT(*) FROM votes WHERE room_id=?)<200').bind(crypto.randomUUID(),id,owner,nickname,nickname.toLocaleLowerCase(),picked.id,new Date().toISOString(),id,id),
              db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND deleted_at IS NULL').bind(id),
              recordParticipation(db,id,owner),
              db.prepare(`INSERT INTO visitor_preferences (owner,nickname) SELECT voter,nickname FROM votes WHERE room_id=? AND voter=?
                ON CONFLICT(owner) DO UPDATE SET nickname=excluded.nickname`).bind(id,owner),
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
        if(!room.total) throw new UserError('至少收到一票后才能结束。');
        // Anyone with the room link can close voting. Only the first close fixes the winner and delivery clock.
        await db.prepare("UPDATE rooms SET status='closed',decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,winner_id=(SELECT c.id FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY COUNT(v.id) DESC,random() LIMIT 1) WHERE id=? AND status='open' AND deleted_at IS NULL").bind(id,id).run();
        result=await roomState(db,id,owner);
      } else if (body.action==='stopOrders') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(room.orders_stopped_at) result=room;
        else {
          if(room.phase==='finished') throw mealFinishedError(room);
          if(room.status!=='closed') throw new UserError('确定餐馆后才能停止加单。',409);
          if(!room.canStopOrders) throw new UserError('只有发起人或当前已认领带饭的人可以停止加单。',403);
          const changed=await db.prepare(`UPDATE rooms SET orders_stopped_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1
            WHERE id=? AND orders_stopped_at IS NULL AND ${ACTIVE_DELIVERY_SQL}
            AND (owner=? OR EXISTS (SELECT 1 FROM orders WHERE room_id=rooms.id AND claimant=? AND status='claimed'))`).bind(id,owner,owner).run();
          const current=await roomState(db,id,owner);
          if(!changed.meta.changes&&!current.orders_stopped_at) {
            if(current.phase==='finished') throw mealFinishedError(current);
            throw new UserError('认领状态已变化，请查看最新清单后重试。',409,'ORDER_CHANGED',current);
          }
          result=current;
        }
      } else if (body.action==='order' || body.action==='editOrder' || body.action==='claim' || body.action==='deliver' || body.action==='release' || body.action==='cancelOrder') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(room.status!=='closed') throw new UserError('餐馆确定后才能登记带饭。',409);
        // Retrying the final delivery or an already accepted order remains safe after completion.
        const retryId=clean(body.orderId,64,'带饭编号');
        if(foodRetryAccepted(room,body.action,retryId,body.expectedRevision)) result=room;
        else if(room.phase==='finished') throw mealFinishedError(room);
        else {
        let statement: D1PreparedStatement;
        if(body.action==='order') {
          if(room.orders_stopped_at) throw new UserError('本轮已停止加单，已有登记仍可继续认领和带回。',409,'ORDERS_STOPPED',room);
          const nickname=clean(body.nickname,24,'群昵称'),dish=clean(body.dish,100,'菜名'),note=clean(body.note,240,'备注',false);
          const quantity=body.quantity;
          if(typeof quantity!=='number'||!Number.isInteger(quantity)||quantity<1||quantity>20) throw new UserError('份数请填写 1–20。');
          const orderId=clean(body.orderId,64,'登记编号');
          if(!/^[a-f0-9-]{36}$/.test(orderId)) throw new UserError('登记编号无效。');
          // A client-generated request ID makes retrying a submitted order safe.
          statement=db.prepare(`INSERT OR IGNORE INTO orders (id,room_id,owner,nickname,dish,quantity,note,status,created_at) SELECT ?,?,?,?,?,?,?,'pending',? WHERE (SELECT COUNT(*) FROM orders WHERE room_id=?)<200 AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND orders_stopped_at IS NULL AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,owner,nickname,dish,quantity,note,new Date().toISOString(),id,id);
        } else {
          const orderId=clean(body.orderId,64,'带饭编号');
          const order=room.orders.find(o=>o.id===orderId);
          if(!order) throw new UserError('这条带饭登记已取消，请刷新。',404);
          if(body.action==='editOrder' || body.action==='claim' || body.action==='deliver' || body.action==='release') {
            if(!Number.isInteger(body.expectedRevision)) throw new UserError('页面已更新，请刷新页面后再操作。',409,'ORDER_CHANGED',room);
            if(body.expectedRevision!==order.revision) throw new UserError('这条登记已更新，请查看最新内容后重试。',409,'ORDER_CHANGED',room);
          }
          if(body.action==='editOrder') {
            if(!order.isMine) throw new UserError('只能修改自己的带饭登记。',403);
            if(order.status!=='pending') throw new UserError('这份带饭已被认领，不能再修改，请联系带饭人。',409,'ORDER_CHANGED',room);
            const dish=clean(body.dish,100,'菜名'),note=clean(body.note,240,'备注',false),quantity=body.quantity;
            if(typeof quantity!=='number'||!Number.isInteger(quantity)||quantity<1||quantity>20) throw new UserError('份数请填写 1–20。');
            statement=db.prepare(`UPDATE orders SET dish=?,quantity=?,note=?,revision=revision+1
              WHERE id=? AND room_id=? AND owner=? AND status='pending' AND revision=?
              AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(dish,quantity,note,orderId,id,owner,body.expectedRevision,id);
          } else if(body.action==='claim') {
            const name=clean(body.nickname,24,'带饭人的群昵称');
            statement=db.prepare(`UPDATE orders SET status='claimed',claimant=?,claimant_name=?,revision=revision+1 WHERE id=? AND room_id=? AND status='pending' AND revision=? AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(owner,name,orderId,id,order.revision,id);
          } else if(body.action==='cancelOrder') {
            if(!order.isMine) throw new UserError('只能取消自己的带饭登记。',403);
            if(order.status!=='pending') throw new UserError('已有朋友认领，请在群里联系带饭人。',409);
            statement=db.prepare(`DELETE FROM orders WHERE id=? AND room_id=? AND owner=? AND status='pending' AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,owner,id);
          } else {
            if(!order.canManage) throw new UserError('只有带饭人或本轮发起人可以操作。',403);
            statement=body.action==='deliver' ? db.prepare(`UPDATE orders SET status='delivered',revision=revision+1 WHERE id=? AND room_id=? AND status='claimed' AND revision=? AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?)) AND (?=1 OR EXISTS (SELECT 1 FROM orders other WHERE other.room_id=orders.room_id AND other.id<>orders.id AND other.status<>'delivered')) AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,body.expectedRevision,owner,id,owner,body.confirmFinish===true?1:0,id) : db.prepare(`UPDATE orders SET status='pending',claimant=NULL,claimant_name=NULL,revision=revision+1 WHERE id=? AND room_id=? AND status='claimed' AND revision=? AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?)) AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,body.expectedRevision,owner,id,owner,id);
          }
        }
        // Preserve the existing order owner and claimant before cancellation or release,
        // including a host releasing a guest's claim created before this feature existed.
        const normalizedOrderId=clean(body.orderId,64,'带饭编号');
        const previousParticipants=db.prepare(`INSERT OR IGNORE INTO room_history (owner,room_id,created_at)
          SELECT people.owner,people.room_id,people.created_at FROM (
            SELECT owner,room_id,created_at FROM orders WHERE id=? AND room_id=?
            UNION SELECT claimant AS owner,room_id,created_at FROM orders WHERE id=? AND room_id=? AND claimant IS NOT NULL
          ) people JOIN rooms r ON r.id=people.room_id WHERE r.owner<>people.owner AND r.deleted_at IS NULL`)
          .bind(normalizedOrderId,id,normalizedOrderId,id);
        const changed=await db.batch([previousParticipants,statement,db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND deleted_at IS NULL').bind(id),recordParticipation(db,id,owner),
          ...(body.action==='order' || body.action==='claim' ? [db.prepare(`INSERT INTO visitor_preferences (owner,nickname)
            SELECT ?,${body.action==='order'?'nickname':'claimant_name'} FROM orders WHERE id=? AND room_id=? AND ${body.action==='order'?'owner':'claimant'}=?
            ON CONFLICT(owner) DO UPDATE SET nickname=excluded.nickname`).bind(owner,normalizedOrderId,id,owner)] : []),
          finishMeal(db,'id=?',[id])]);
        const current=await roomState(db,id,owner);
        if(!changed[1].meta.changes && !foodRetryAccepted(current,body.action,normalizedOrderId,body.expectedRevision)) {
          if(current.phase==='finished') throw mealFinishedError(current);
          const latest=current.orders.find(o=>o.id===normalizedOrderId);
          if(body.action==='order' && current.orders_stopped_at) throw new UserError('本轮刚刚停止加单，填写内容已保留。',409,'ORDERS_STOPPED',current);
          if((body.action==='deliver'||body.action==='release')&&latest?.revision!==body.expectedRevision) throw new UserError('这份登记或认领人已变化，请查看最新内容后重试。',409,'ORDER_CHANGED',current);
          if(body.action==='deliver' && body.confirmFinish!==true && latest?.status==='claimed' && latest.canManage && current.orders.filter(o=>o.status!=='delivered').length===1)
            throw new UserError('这是最后一份带饭，确认带回后本轮将结束。',409,'FINAL_DELIVERY_CONFIRM_REQUIRED',current);
          if(body.action==='editOrder' || body.action==='claim') throw new UserError('这条登记刚被修改或认领，请查看最新内容后重试。',409,'ORDER_CHANGED',current);
          throw new UserError(body.action==='order' ? '本轮带饭清单已满，请在群里联系发起人。' : '这条登记刚被更新，请查看最新清单。',409);
        }
        result=current;
        }
      } else throw new UserError('未知操作。');
    }
    const headers: Record<string,string>={'Cache-Control':'no-store'};
    if(cookie) headers['Set-Cookie']=cookie;
    return Response.json(result,{headers});
  } catch(error) {
    if(!(error instanceof UserError)) console.error('Fandian request failed',error);
    const headers: Record<string,string>={'Cache-Control':'no-store'}; if(cookie) headers['Set-Cookie']=cookie;
    return Response.json({error:error instanceof UserError ? error.message : '暂时连接不上，请稍后重试。你的填写内容仍然保留。',...(error instanceof UserError && error.code ? {code:error.code,room:error.room} : {})},{status:error instanceof UserError ? error.status : 503,headers});
  }
}
export const GET=handle;
export const POST=handle;
