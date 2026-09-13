import { similarRestaurants } from '@/lib/restaurant-match';
import { readDraft, writeDraft, DraftError } from '@/lib/order-draft-store';
import { notifications } from '@/lib/meal-updates';
import { OPEN_VOTING_SQL,settleVoting,votingDeadline } from '@/lib/voting-deadline';
import { chatGPTSignInPath, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { visitorIdentity } from '@/lib/visitor-identity';
import { database } from '@/lib/game-db';
import { MenuError, menuIds, restaurantWebsite, restaurantWithMedia } from '@/lib/restaurant-media';
import { seeds } from '@/lib/seeds';
import { PayloadTooLargeError, readRequestText } from '@/lib/request-body';
import { ACTIVE_DELIVERY_SQL, finishMeal, mealLifecycle, settleMeals, type LifecycleRow } from '@/lib/meal-lifecycle';
import type { Restaurant, Room, Vote, FoodOrder, HistoryRoom, HistoryPage, HomeMeal, VotingMode, Profile, Member, AccountSession, PickupPlan, RestaurantPool } from '@/lib/types';

export const dynamic = 'force-dynamic';
class UserError extends Error { constructor(message: string, public status = 400, public code?: string, public room?: Room, public details?:Record<string,unknown>) { super(message); } }
type RestaurantRow = Omit<Restaurant,'menu_images'> & {menu_images:string};
type OrderSubmission = {nickname:string;dish:string;quantity:number;note:string};
function orderSubmission(body: Record<string,unknown>): OrderSubmission {
  const nickname=clean(body.nickname,24,'群昵称'),dish=clean(body.dish,100,'菜名'),note=clean(body.note,240,'备注',false),quantity=body.quantity;
  if(typeof quantity!=='number'||!Number.isInteger(quantity)||quantity<1||quantity>20) throw new UserError('份数请填写 1–20。');
  return {nickname,dish,quantity,note};
}
async function foodRetryAccepted(db: D1Database, room: Room, action: unknown, orderId: string, expectedRevision?: unknown, submission?: OrderSubmission) {
  const existing=room.orders.find(order=>order.id===orderId);
  if(action==='order' && existing?.isMine && submission) {
    const saved=await db.prepare('SELECT creation_request_hash,nickname,dish,quantity,note FROM orders WHERE id=? AND room_id=?').bind(orderId,room.id).first<OrderSubmission & {creation_request_hash:string|null}>();
    // Keep the original fingerprint after later edits, so the original request can still retry safely.
    const matches=saved?.creation_request_hash
      ? saved.creation_request_hash===await hashText(JSON.stringify(submission))
      : Object.entries(submission).every(([key,value])=>saved?.[key as keyof OrderSubmission]===value);
    if(!matches) throw new UserError('这次登记已保存过，重试内容与首次提交不同。请查看「我的登记」，再使用编辑修改。',409,'ORDER_REQUEST_CONFLICT',room);
    return true;
  }
  return action==='deliver' && existing?.status==='delivered' && existing.canManage && Number.isInteger(expectedRevision) && existing.revision===(expectedRevision as number)+1;
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
async function profile(db: D1Database, owner: string): Promise<Profile> {
  return await db.prepare('SELECT nickname,revision FROM visitor_preferences WHERE owner=?').bind(owner).first<Profile>() || {nickname:'',revision:0};
}
async function saveProfile(db: D1Database, owner: string, body: Record<string,unknown>) {
  const nickname=clean(body.nickname,24,'用户名');
  if(!Number.isInteger(body.expectedRevision)||Number(body.expectedRevision)<0) throw new UserError('请刷新后再修改用户名。',409);
  const current=await profile(db,owner);
  if(current.nickname===nickname) return current; // An accepted rename can be retried after a lost response.
  if(current.revision!==body.expectedRevision) throw new UserError('用户名已在其他页面修改，请重新打开用户名按钮。',409);
  try {
    const saved=await db.prepare(`INSERT INTO visitor_preferences (owner,nickname,nickname_key,revision) VALUES (?,?,?,1)
      ON CONFLICT(owner) DO UPDATE SET nickname=excluded.nickname,nickname_key=excluded.nickname_key,revision=visitor_preferences.revision+1
      WHERE visitor_preferences.revision=?`).bind(owner,nickname,nickname.toLocaleLowerCase(),body.expectedRevision).run();
    if(!saved.meta.changes) throw new UserError('用户名刚被修改，请重新打开用户名按钮。',409);
  } catch(error) {
    if(String(error).includes('UNIQUE')) throw new UserError('你参与过的投票中已有这个昵称，请加上便于区分的称呼。原昵称未改变。',409);
    throw error;
  }
  return profile(db,owner);
}
async function seed(db: D1Database, owner: string) {
  const existing = await db.prepare('SELECT id FROM restaurants WHERE owner = ? LIMIT 1').bind(owner).first();
  if (!existing) await db.batch(seeds.map((s,i) => db.prepare('INSERT OR IGNORE INTO restaurants (id,owner,name,cuisine,address,source,selected,position) VALUES (?,?,?,?,?,?,1,?)').bind(`${owner.slice(0,24)}-${i}`,owner,s.name,s.cuisine,s.address,s.source,i)));
}
async function catalog(db: D1Database, owner: string) {
  await seed(db,'shared');
  await backfillHistory(db,owner);
  await settleVoting(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]).run();
  const visibleFrom=`FROM rooms r LEFT JOIN room_history h ON h.room_id=r.id AND h.owner=?
    WHERE r.deleted_at IS NULL AND (r.owner=? OR (h.room_id IS NOT NULL AND h.hidden_at IS NULL))`;
  const activeFrom=`${visibleFrom} AND (r.status='open' OR (r.status='closed' AND r.completed_at IS NULL))`;
  const summarySelect=`SELECT r.id,r.title,r.status,r.mode,r.voting_deadline_at,r.created_at,r.deleted_at,r.decided_at,r.completed_at,r.completion_reason,r.orders_stopped_at,
    COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=r.owner),'未设置昵称') AS creator_name,r.owner=? AS isHost,(SELECT name FROM candidates WHERE id=r.winner_id AND room_id=r.id) AS winner_name,
    (SELECT COUNT(*) FROM votes WHERE room_id=r.id) AS vote_count,(SELECT COUNT(*) FROM orders WHERE room_id=r.id) AS order_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='pending') AS pending_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='claimed') AS claimed_count,
    (SELECT COUNT(*) FROM orders WHERE room_id=r.id AND status='delivered') AS delivered_count`;
  const [,,restaurants,rooms,active,total,finished] = await db.batch([
    ...settleMeals(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]),
    db.prepare('SELECT id,name,cuisine,address,source,menu_images,media_updated_at,revision,selected,position FROM restaurants WHERE owner=? AND deleted=0 ORDER BY position,id').bind('shared'),
    db.prepare('SELECT id,title,status,mode,voting_deadline_at,created_at,decided_at,completed_at,completion_reason FROM rooms WHERE owner=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 8').bind(owner),
    db.prepare(`${summarySelect} ${activeFrom} ORDER BY r.created_at DESC,r.id DESC LIMIT 8`).bind(owner,owner,owner),
    db.prepare(`SELECT COUNT(*) AS count ${activeFrom}`).bind(owner,owner),
    db.prepare(`${summarySelect} ${visibleFrom} AND r.status='closed'
      AND r.completed_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
      AND EXISTS (SELECT 1 FROM orders WHERE room_id=r.id)
      ORDER BY r.completed_at DESC,r.id DESC LIMIT 4`).bind(owner,owner,owner),
  ]);
  const pools=(await db.prepare('SELECT id,name,restaurant_ids,revision FROM restaurant_pools WHERE owner=? AND deleted_at IS NULL ORDER BY created_at,id').bind(owner).all<Omit<RestaurantPool,'restaurant_ids'> & {restaurant_ids:string}>()).results.map(p=>({...p,restaurant_ids:JSON.parse(p.restaurant_ids) as string[]}));
  const shownMeals=[...active.results,...finished.results] as HomeMeal[];
  const own=shownMeals.length?(await db.prepare(`SELECT o.id,o.room_id,o.dish,o.quantity,o.status,o.purchase_status,o.issue_note,o.change_request,COALESCE(p.nickname,o.claimant_name) AS claimant_name,COALESCE(pp.time,'') AS pickup_time,COALESCE(pp.place,'') AS pickup_place FROM orders o LEFT JOIN visitor_preferences p ON p.owner=o.claimant LEFT JOIN pickup_plans pp ON pp.room_id=o.room_id AND pp.owner=o.claimant WHERE o.owner=? AND o.room_id IN (${shownMeals.map(()=>'?').join(',')}) ORDER BY o.created_at,o.id`).bind(owner,...shownMeals.map(r=>r.id)).all<{room_id:string;change_request:string|null}>()).results:[];
  const personal=(id:string)=>own.filter(o=>o.room_id===id).map(o=>({...o,change_request:o.change_request?JSON.parse(o.change_request):null}));
  return { notifications:await notifications(db,owner),pools,profile:await profile(db,owner),restaurants:(restaurants.results as RestaurantRow[]).map(restaurantWithMedia),
    rooms:(rooms.results as (LifecycleRow & {id:string;title:string;mode:VotingMode})[]).map(row=>({...row,...mealLifecycle(row)})),
    activeRooms:(active.results as HomeMeal[]).map(row=>({...row,...mealLifecycle(row),isHost:!!row.isHost,my_orders:personal(row.id)})),
    recentFinishedRooms:(finished.results as HomeMeal[]).map(row=>({...row,...mealLifecycle(row),isHost:!!row.isHost,my_orders:personal(row.id)})),
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
  await settleVoting(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]).run();
  await db.batch(settleMeals(db,'owner=? OR id IN (SELECT room_id FROM room_history WHERE owner=?)',[owner,owner]));
  const rows = (await db.prepare(`WITH viewer AS (SELECT ? AS owner)
    SELECT r.id,r.title,r.status,r.mode,r.voting_deadline_at,r.created_at,r.decided_at,r.completed_at,r.completion_reason,
    CASE WHEN r.owner=viewer.owner THEN r.deleted_at ELSE h.hidden_at END AS deleted_at,
    COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=r.owner),'未设置昵称') AS creator_name,r.owner=viewer.owner AS isHost,c.name AS winner_name,
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
  return { profile:await profile(db,owner),rooms, nextCursor: rows.length > 20 && last ? JSON.stringify({createdAt:last.created_at,id:last.id}) : null };
}
async function roomState(db: D1Database, id: string, owner: string): Promise<Room> {
  await settleVoting(db,'id=?',[id]).run();
  const [,,roomRows,candidates,votes,myVote,orders,history,preferences,people,pickup] = await db.batch([
    ...settleMeals(db,'id=?',[id]),
    db.prepare("SELECT *,COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=rooms.owner),'未设置昵称') AS creator_name FROM rooms WHERE id=? AND deleted_at IS NULL").bind(id),
    db.prepare('SELECT c.id,c.name,c.cuisine,c.address,c.source,c.menu_images,c.restaurant_id,c.position,COUNT(v.id) AS count FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY c.position').bind(id),
    db.prepare('SELECT COALESCE(p.nickname,v.nickname) AS nickname,candidate_id,created_at FROM votes v LEFT JOIN visitor_preferences p ON p.owner=v.voter WHERE room_id=? ORDER BY created_at DESC').bind(id),
    db.prepare('SELECT COALESCE(p.nickname,v.nickname) AS nickname,candidate_id,created_at FROM votes v LEFT JOIN visitor_preferences p ON p.owner=v.voter WHERE room_id=? AND voter=?').bind(id,owner),
    db.prepare(`SELECT o.*,COALESCE(p.nickname,o.nickname) AS display_nickname,COALESCE(c.nickname,o.claimant_name) AS display_claimant,COALESCE(pp.time,'') AS pickup_time,COALESCE(pp.place,'') AS pickup_place FROM orders o LEFT JOIN visitor_preferences p ON p.owner=o.owner LEFT JOIN visitor_preferences c ON c.owner=o.claimant LEFT JOIN pickup_plans pp ON pp.room_id=o.room_id AND pp.owner=o.claimant WHERE o.room_id=? ORDER BY o.created_at,o.id`).bind(id),
    db.prepare('SELECT hidden_at FROM room_history WHERE owner=? AND room_id=?').bind(owner,id),
    db.prepare('SELECT nickname,revision FROM visitor_preferences WHERE owner=?').bind(owner),
    db.prepare(`WITH people AS (
      SELECT owner FROM rooms WHERE id=? UNION SELECT voter FROM votes WHERE room_id=?
      UNION SELECT owner FROM orders WHERE room_id=? UNION SELECT claimant FROM orders WHERE room_id=? AND claimant IS NOT NULL
    ) SELECT COALESCE(p.nickname,(SELECT nickname FROM votes WHERE room_id=? AND voter=people.owner LIMIT 1),
      (SELECT nickname FROM orders WHERE room_id=? AND owner=people.owner LIMIT 1),
      (SELECT claimant_name FROM orders WHERE room_id=? AND claimant=people.owner LIMIT 1),'未设置昵称') AS nickname,
      people.owner=? AS isMe,people.owner=(SELECT owner FROM rooms WHERE id=?) AS isHost,
      EXISTS(SELECT 1 FROM votes WHERE room_id=? AND voter=people.owner) AS hasVoted,
      (SELECT COUNT(*) FROM orders WHERE room_id=? AND owner=people.owner) AS requests,
      (SELECT COUNT(*) FROM orders WHERE room_id=? AND claimant=people.owner AND status='claimed') AS carrying,
      (SELECT COUNT(*) FROM orders WHERE room_id=? AND claimant=people.owner AND status='delivered') AS delivered
      FROM people LEFT JOIN visitor_preferences p ON p.owner=people.owner ORDER BY isHost DESC,nickname,people.owner`)
      .bind(id,id,id,id,id,id,id,owner,id,id,id,id,id),
    db.prepare('SELECT time,place,revision FROM pickup_plans WHERE room_id=? AND owner=?').bind(id,owner),
  ]);
  const room=roomRows.results[0] as (LifecycleRow & {id:string;title:string;status:string;mode:VotingMode;winner_id:string|null;created_at:string;revision:number;owner:string;orders_stopped_at:string|null;creator_name:string})|undefined;
  if (!room) throw new UserError('这轮投票不存在或已被发起人删除。发起人可在历史记录的回收站中恢复。',404);
  const personalHistory=history.results[0] as {hidden_at:string|null}|undefined;
  const participated=myVote.results.length>0 || (orders.results as {owner:string;claimant:string|null}[]).some(o=>o.owner===owner||o.claimant===owner);
  const winner=(candidates.results as RestaurantRow[]).find(c=>c.id===room.winner_id);
  const matchingRestaurants=winner?(await db.prepare("SELECT id FROM restaurants WHERE owner='shared' AND deleted=0 AND name=? AND cuisine=? AND address=? LIMIT 2").bind(winner.name,winner.cuisine,winner.address).all<{id:string}>()).results:[];
  const allowLegacy=matchingRestaurants.length===1&&(!winner?.restaurant_id||matchingRestaurants[0].id===winner.restaurant_id);
  const recent=winner?(await db.prepare(`SELECT o.dish,o.quantity,o.note FROM orders o JOIN rooms r ON r.id=o.room_id JOIN candidates c ON c.id=r.winner_id
    WHERE o.owner=? AND o.room_id<>? AND r.deleted_at IS NULL AND c.room_id=r.id
    AND ((? IS NOT NULL AND c.restaurant_id=?) OR (?=1 AND c.restaurant_id IS NULL AND c.name=? AND c.cuisine=? AND c.address=?))
    ORDER BY o.created_at DESC,o.id DESC LIMIT 50`).bind(owner,id,winner.restaurant_id||null,winner.restaurant_id||null,allowLegacy?1:0,winner.name,winner.cuisine,winner.address).all<{dish:string;quantity:number;note:string}>()).results:[];
  const uniqueDishes=recent.filter((o,i)=>recent.findIndex(other=>other.dish===o.dish&&other.note===o.note)===i).slice(0,5);
  return { notifications:await notifications(db,owner),recentDishes:uniqueDishes,myPickupPlan:(pickup.results[0] as PickupPlan|undefined)||{time:'',place:'',revision:0},canEditPickupPlan:(orders.results as {claimant:string;status:string}[]).some(o=>o.claimant===owner&&o.status==='claimed'),...mealLifecycle(room),profile:(preferences.results[0] as Profile|undefined)||{nickname:'',revision:0},creator_name:room.creator_name,members:(people.results as Member[]).map(p=>({...p,isMe:!!p.isMe,isHost:!!p.isHost,hasVoted:!!p.hasVoted})),orders_stopped_at:room.orders_stopped_at,canStopOrders:room.owner===owner || (orders.results as {status:string;claimant:string|null}[]).some(o=>o.status==='claimed'&&o.claimant===owner),preferred_nickname:String((preferences.results[0] as {nickname:string}|undefined)?.nickname || ''),id:room.id,title:room.title,status:room.status,mode:room.mode,winner_id:room.winner_id,created_at:room.created_at,revision:room.revision,isHost:room.owner===owner,inHistory:room.owner===owner || (personalHistory ? personalHistory.hidden_at===null : participated),candidates:(candidates.results as RestaurantRow[]).map(restaurantWithMedia),votes:votes.results as Vote[],myVote:myVote.results[0] as Vote||null,total:votes.results.length,orders:(orders.results as (FoodOrder & {owner:string;claimant:string|null;display_nickname:string;display_claimant:string|null})[]).map(o=>({id:o.id,purchase_status:o.purchase_status,issue_note:o.issue_note,change_request:typeof o.change_request==='string'?JSON.parse(o.change_request):o.change_request,pickup_time:o.pickup_time,pickup_place:o.pickup_place,nickname:o.display_nickname,dish:o.dish,quantity:o.quantity,note:o.note,status:o.status,revision:o.revision,isCarrier:o.claimant===owner,claimant_name:o.display_claimant,created_at:o.created_at,isMine:o.owner===owner,canManage:o.claimant===owner||room.owner===owner})) };
}
async function latestMenu(db:D1Database,room:Room,candidateId:string) {
  const candidate=room.candidates.find(c=>c.id===candidateId);
  if(!candidate) throw new UserError('这家餐馆不在本轮候选中。',404);
  let rows:RestaurantRow[];
  if(candidate.restaurant_id) rows=(await db.prepare("SELECT id,name,cuisine,address,source,menu_images,media_updated_at,revision,selected,position FROM restaurants WHERE id=? AND owner='shared' AND deleted=0").bind(candidate.restaurant_id).all<RestaurantRow>()).results;
  else rows=(await db.prepare("SELECT id,name,cuisine,address,source,menu_images,media_updated_at,revision,selected,position FROM restaurants WHERE owner='shared' AND deleted=0 AND name=? AND cuisine=? AND address=? LIMIT 2").bind(candidate.name,candidate.cuisine,candidate.address).all<RestaurantRow>()).results;
  return rows.length===1?{restaurant:restaurantWithMedia(rows[0])}:{restaurant:null,message:candidate.restaurant_id?'这家餐馆已从餐馆库移除，本轮原菜单仍可查看。':'无法准确对应到当前餐馆，请到餐馆清单中查看最新菜单。本轮原菜单仍保留。'};
}
async function handle(request: Request) {
  let cookie: string | null = null;
  let viewKey='';
  let account:AccountSession|undefined;
  let authAvailable=false;
  try {
    const url=new URL(request.url);
    if(request.method!=='GET') {
      const origin=request.headers.get('origin');
      if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new UserError('请在投票页面内操作。',403);
    }
    const db=database();
    const identityResult = await visitorIdentity(request,db); cookie=identityResult.cookie;viewKey=identityResult.viewKey;account=identityResult.account;authAvailable=identityResult.authAvailable;
    const owner=identityResult.owner;
    let result: unknown;
    if (request.method === 'GET') {
      const room=url.searchParams.get('room');
      result=room&&url.searchParams.has('draft') ? await readDraft(db,clean(room,64,'投票编号'),owner) : url.searchParams.has('profile') ? await profile(db,owner) : room ? url.searchParams.has('menu') ? await latestMenu(db,await roomState(db,clean(room,64,'投票编号'),owner),clean(url.searchParams.get('menu'),80,'候选编号')) : await roomState(db,clean(room,64,'投票编号'),owner) : url.searchParams.has('history') ? await historyPage(db,owner,url) : await catalog(db,owner);
    } else {
      const expectedIdentity=request.headers.get('x-fandian-identity');
      if((expectedIdentity&&expectedIdentity!==viewKey)||(!expectedIdentity&&identityResult.account.signed_in))
        throw new UserError('登录身份已变化，请刷新页面后再操作。',409,'AUTH_CHANGED');
      if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw new UserError('请使用投票页面提交内容。',415);
      const raw=await readRequestText(request);
      let body: Record<string,unknown>;
      try { body=JSON.parse(raw); } catch { throw new UserError('提交内容无效。'); }
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new UserError('提交内容无效。');
      if(body.action==='saveOrderDraft'||body.action==='clearOrderDraft'){
        result=await writeDraft(db,clean(body.room,64,'投票编号'),owner,body);
      } else if(body.action==='readUpdates'){
        if(!Number.isSafeInteger(body.throughId)||Number(body.throughId)<1)throw new UserError('更新编号无效。');
        await db.prepare("UPDATE notifications SET read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner=? AND id<=? AND read_at IS NULL").bind(owner,body.throughId).run();
        result={ok:true};
      } else if (body.action==='saveProfile') {
        result=await saveProfile(db,owner,body);
      } else if (body.action==='savePool') {
        const name=clean(body.name,40,'餐馆池名称');
        if(!Array.isArray(body.restaurantIds)||body.restaurantIds.length<2||body.restaurantIds.length>100) throw new UserError('餐馆池请选择 2–100 家餐馆。');
        const ids=[...new Set(body.restaurantIds.map(id=>clean(id,80,'餐馆编号')))].sort();
        if(ids.length<2) throw new UserError('请选择至少两家不同的餐馆。');
        const json=JSON.stringify(ids),fingerprint=await hashText(JSON.stringify({name,ids}));
        const now=new Date().toISOString();
        const valid=`(SELECT COUNT(*) FROM restaurants WHERE owner='shared' AND deleted=0 AND id IN (SELECT value FROM json_each(?)))=?`;
        if(body.id) {
          if(!Number.isInteger(body.expectedRevision)) throw new UserError('请刷新后修改餐馆池。',409);
          const id=clean(body.id,64,'餐馆池编号');
          const current=await db.prepare('SELECT name,restaurant_ids,revision FROM restaurant_pools WHERE id=? AND owner=? AND deleted_at IS NULL').bind(id,owner).first<{name:string;restaurant_ids:string;revision:number}>();
          if(!current) throw new UserError('餐馆池不存在。',404);
          if(current.name!==name||current.restaurant_ids!==json) {
            const changed=await db.prepare(`UPDATE restaurant_pools SET name=?,restaurant_ids=?,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NULL AND revision=? AND ${valid}`).bind(name,json,id,owner,body.expectedRevision,json,ids.length).run();
            if(!changed.meta.changes) throw new UserError('餐馆池或餐馆清单已变化，请刷新后重新选择。',409);
          }
        } else {
          const requestId=clean(body.requestId,36,'请求编号');if(!/^[a-f0-9-]{36}$/.test(requestId)) throw new UserError('请求编号无效。');
          const id=(await hashText(`pool:${owner}:${requestId}`)).slice(0,32);
          await db.prepare(`INSERT OR IGNORE INTO restaurant_pools (id,owner,name,restaurant_ids,creation_hash,created_at) SELECT ?,?,?,?,?,?
            WHERE (SELECT COUNT(*) FROM restaurant_pools WHERE owner=? AND deleted_at IS NULL)<20 AND ${valid}`).bind(id,owner,name,json,fingerprint,now,owner,json,ids.length).run();
          const saved=await db.prepare('SELECT creation_hash,deleted_at FROM restaurant_pools WHERE id=? AND owner=?').bind(id,owner).first<{creation_hash:string;deleted_at:string|null}>();
          if(!saved) throw new UserError('最多保存 20 个餐馆池，或所选餐馆刚被删除。请刷新后重试。',409);
          if(saved.deleted_at||saved.creation_hash!==fingerprint) throw new UserError('这次请求已保存或删除过，请刷新查看餐馆池。',409);
        }
        result=await catalog(db,owner);
      } else if (body.action==='deletePool') {
        const changed=await db.prepare('UPDATE restaurant_pools SET deleted_at=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL').bind(new Date().toISOString(),clean(body.id,64,'餐馆池编号'),owner,Number.isInteger(body.expectedRevision)?body.expectedRevision:-1).run();
        if(!changed.meta.changes) throw new UserError('餐馆池已变化，请刷新后重试。',409);
        result=await catalog(db,owner);
      } else if (body.action==='savePickupPlan') {
        const id=clean(body.room,64,'饭局编号'),room=await roomState(db,id,owner);
        if(room.phase!=='delivery') throw new UserError('当前不能修改取餐安排。',409);
        if(!room.canEditPickupPlan) throw new UserError('请先认领带饭，再填写自己的取餐安排。',403);
        const time=clean(body.time,60,'预计带回时间',false),place=clean(body.place,120,'取餐地点',false);
        if(!Number.isInteger(body.expectedRevision)||Number(body.expectedRevision)<0) throw new UserError('请刷新后修改取餐安排。',409);
        if(room.myPickupPlan.time!==time||room.myPickupPlan.place!==place) {
          const [changed]=await db.batch([
            db.prepare(`INSERT INTO pickup_plans (room_id,owner,time,place,revision) SELECT ?,?,?,?,1 WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})
              AND EXISTS (SELECT 1 FROM orders WHERE room_id=? AND claimant=? AND status='claimed')
              AND (?=0 OR EXISTS(SELECT 1 FROM pickup_plans WHERE room_id=? AND owner=?))
              ON CONFLICT(room_id,owner) DO UPDATE SET time=excluded.time,place=excluded.place,revision=pickup_plans.revision+1 WHERE pickup_plans.revision=?`)
              .bind(id,owner,time,place,id,id,owner,body.expectedRevision,id,owner,body.expectedRevision),
            db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND changes()>0').bind(id),
          ]);
          if(!changed.meta.changes) throw new UserError('取餐安排或认领状态已变化，请查看最新内容。',409,'PICKUP_CHANGED',await roomState(db,id,owner));
        }
        result=await roomState(db,id,owner);
      } else if (body.action==='saveHistory') {
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
        const id=body.id ? clean(body.id,80,'餐馆编号') : crypto.randomUUID();
        const old=body.id ? await db.prepare("SELECT * FROM restaurants WHERE id=? AND owner='shared' AND deleted=0").bind(id).first<RestaurantRow>() : null;
        if(body.id && !old) throw new UserError('餐馆不存在。',404);
        if(old&&(!Number.isInteger(body.expectedRevision)||old.revision!==body.expectedRevision))throw new UserError('餐馆已被更新，请核对最新资料后再保存。',409,'RESTAURANT_CHANGED',undefined,{restaurant:restaurantWithMedia(old)});
        if(!old){
          const list=(await db.prepare("SELECT * FROM restaurants WHERE owner='shared' AND deleted=0").all<RestaurantRow>()).results.map(restaurantWithMedia);
          const matches=similarRestaurants(name,list);
          if(matches.some(r=>!Array.isArray(body.duplicateIds)||!body.duplicateIds.includes(r.id)))throw new UserError('已有相似餐馆，请选择编辑已有餐馆，或确认添加另一家分店。',409,'RESTAURANT_DUPLICATE',undefined,{restaurants:matches});
        }
        // Omitted fields from an older client must not erase menus or website links.
        const source=body.source===undefined ? old?.source || '' : restaurantWebsite(body.source);
        const images=body.menu_images===undefined ? old?.menu_images || '[]' : JSON.stringify(menuIds(body.menu_images));
        const validImages=`NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN menu_images m ON m.id=j.value
          WHERE m.id IS NULL OR m.ready<>1 OR (m.published=0 AND m.owner<>?))`;
        const mutation=body.id
          ? db.prepare(`UPDATE restaurants SET name=?,cuisine=?,address=?,revision=revision+1,media_updated_at=CASE WHEN source<>? OR menu_images<>? THEN ? ELSE media_updated_at END,source=?,menu_images=?
              WHERE id=? AND owner='shared' AND deleted=0 AND revision=? AND ${validImages}`).bind(name,cuisine,address,source,images,new Date().toISOString(),source,images,id,body.expectedRevision,images,owner)
          : db.prepare(`INSERT INTO restaurants (id,owner,name,cuisine,address,source,menu_images,media_updated_at,selected,position)
              SELECT ?,'shared',?,?,?,?,?,?,1,? WHERE (SELECT COUNT(*) FROM restaurants WHERE owner='shared' AND deleted=0)<100
              AND ${validImages}`).bind(id,name,cuisine,address,source,images,new Date().toISOString(),Date.now(),images,owner);
        const [changed]=await db.batch([
          mutation,
          db.prepare(`UPDATE menu_images SET published=1 WHERE id IN
            (SELECT value FROM json_each((SELECT menu_images FROM restaurants WHERE id=? AND owner='shared' AND deleted=0)))`).bind(id),
        ]);
        if(!changed.meta.changes&&old){const latest=await db.prepare("SELECT * FROM restaurants WHERE id=? AND owner='shared' AND deleted=0").bind(id).first<RestaurantRow>();if(!latest||latest.revision!==body.expectedRevision)throw new UserError(latest?'餐馆已被更新，请核对最新资料后再保存。':'这家餐馆刚被删除。',409,'RESTAURANT_CHANGED',undefined,{restaurant:latest?restaurantWithMedia(latest):null});}
        if(!changed.meta.changes) throw new UserError('餐馆未保存：菜单图片已过期、尚未上传完成，或餐馆库已满。请重新选择图片或刷新列表后再试。',409);
        result=await catalog(db,owner);
      } else if (body.action==='deleteRestaurant' || body.action==='restoreRestaurant') {
        const id=clean(body.id,80,'餐馆编号');
        const existing=await db.prepare('SELECT id FROM restaurants WHERE id=? AND owner=\'shared\'').bind(id).first();
        if(!existing) throw new UserError('餐馆不存在。',404);
        if(body.action==='deleteRestaurant') {
          // Keep the row as a tombstone: an empty catalog must not regenerate the initial seeds.
          await db.prepare('UPDATE restaurants SET deleted=1,revision=revision+1 WHERE id=? AND owner=\'shared\'').bind(id).run();
        } else {
          const restored=await db.prepare('UPDATE restaurants SET deleted=0,revision=revision+1 WHERE id=? AND owner=\'shared\' AND (deleted=0 OR (SELECT COUNT(*) FROM restaurants WHERE owner=\'shared\' AND deleted=0)<100)').bind(id).run();
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
        let deadline:string|null;try{deadline=votingDeadline(body.votingDeadlineAt);}catch(e){throw new UserError((e as Error).message);}
        const requestHash=await hashText(JSON.stringify({title,mode,restaurantIds:ids,...(deadline?{votingDeadlineAt:deadline}:{})}));
        const existing=await db.prepare('SELECT creation_request_hash FROM rooms WHERE id=? AND owner=?').bind(id,owner).first<{creation_request_hash:string|null}>();
        if(!existing) {
          if(deadline&&(Date.parse(deadline)<=Date.now()||Date.parse(deadline)>Date.now()+14*86400000))throw new UserError('截止时间请选择未来 14 天内的时间。');
          await seed(db,'shared');
          const rows=(await db.prepare(`SELECT * FROM restaurants WHERE owner='shared' AND deleted=0 AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY position,id`).bind(...ids).all<RestaurantRow>()).results;
          if(rows.length!==ids.length) throw new UserError('候选名单已变化，请刷新后重新选择。');
          // The room and its complete candidate snapshot commit together. Retry IDs are stable.
          await db.batch([
            db.prepare("INSERT OR IGNORE INTO rooms (id,owner,title,status,created_at,mode,creation_request_hash,voting_deadline_at) VALUES (?,?,?,'open',?,?,?,?)").bind(id,owner,title,new Date().toISOString(),mode,requestHash,deadline),
            ...rows.map((r,i)=>db.prepare(`INSERT OR IGNORE INTO candidates (id,room_id,name,cuisine,address,source,menu_images,restaurant_id,position)
              SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=? AND creation_request_hash=?)`)
              .bind(`${id}-${i+1}`,id,r.name,r.cuisine,r.address,r.source,r.menu_images,r.id,i+1,id,owner,requestHash)),
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
            db.prepare(`INSERT OR IGNORE INTO candidates (id,room_id,name,cuisine,address,source,menu_images,restaurant_id,position)
              SELECT ? || '-' || c.position,?,c.name,c.cuisine,c.address,c.source,c.menu_images,c.restaurant_id,c.position FROM candidates c
              JOIN rooms original ON original.id=c.room_id
              WHERE c.room_id=? AND original.deleted_at IS NULL AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=?)`).bind(id,id,sourceId,id,owner),
          ]);
        }
        result=await roomState(db,id,owner);
      } else if (body.action==='vote') {
        const id=clean(body.room,64,'投票编号'),submittedNickname=clean(body.nickname,24,'群昵称');
        const room=await roomState(db,id,owner);
        const nickname=room.preferred_nickname||submittedNickname;
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
              db.prepare('INSERT INTO votes (id,room_id,voter,nickname,nickname_key,candidate_id,created_at) SELECT ?,?,?,COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=?),?),COALESCE((SELECT nickname_key FROM visitor_preferences WHERE owner=?),?),?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND status=\'open\' AND deleted_at IS NULL AND (voting_deadline_at IS NULL OR voting_deadline_at>strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))) AND (SELECT COUNT(*) FROM votes WHERE room_id=?)<200').bind(crypto.randomUUID(),id,owner,owner,nickname,owner,nickname.toLocaleLowerCase(),picked.id,new Date().toISOString(),id,id),
              db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND deleted_at IS NULL').bind(id),
              recordParticipation(db,id,owner),
              db.prepare(`INSERT INTO visitor_preferences (owner,nickname,nickname_key) SELECT voter,nickname,nickname_key FROM votes WHERE room_id=? AND voter=?
                ON CONFLICT(owner) DO NOTHING`).bind(id,owner),
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
        if(!room.total&&room.status==='open') throw new UserError('至少收到一票后才能结束。');
        // Anyone with the room link can close voting. Only the first close fixes the winner and delivery clock.
        await db.prepare(`UPDATE rooms SET status='closed',decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revision=revision+1,winner_id=(SELECT c.id FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=? GROUP BY c.id ORDER BY COUNT(v.id) DESC,random() LIMIT 1) WHERE id=? AND ${OPEN_VOTING_SQL}` ).bind(id,id).run();
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
      } else if(['markOrdered','markSoldOut','requestChange','acceptChange','rejectChange'].includes(String(body.action))) {
        const id=clean(body.room,64,'饭局编号'),room=await roomState(db,id,owner),orderId=clean(body.orderId,64,'登记编号');
        const order=room.orders.find(o=>o.id===orderId);
        if(!order)throw new UserError('这条登记不存在。',404);
        if(room.phase!=='delivery')throw mealFinishedError(room);
        if(order.status!=='claimed')throw new UserError('只有已认领、尚未带回的登记可以操作。',409,'ORDER_CHANGED',room);
        if(!Number.isInteger(body.expectedRevision)||body.expectedRevision!==order.revision)throw new UserError('登记已变化，请查看最新内容后确认。',409,'ORDER_CHANGED',room);
        const action=String(body.action);
        if(action==='requestChange'?!order.isMine:!order.isCarrier)throw new UserError(action==='requestChange'?'只能为自己的登记申请改单。':'请由当前带饭人确认。',403);
        let statement:D1PreparedStatement;
        const guard=`id=? AND room_id=? AND revision=? AND status='claimed' AND ${action==='requestChange'?'owner':'claimant'}=? AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`;
        const values=[orderId,id,order.revision,owner,id];
        if(action==='requestChange'){
          const dish=clean(body.dish,100,'菜名'),note=clean(body.note,240,'备注',false),quantity=body.quantity;
          if(!Number.isInteger(quantity)||Number(quantity)<1||Number(quantity)>20)throw new UserError('份数请填写 1–20。');
          if(dish===order.dish&&note===order.note&&quantity===order.quantity)throw new UserError('请填写需要更换的菜品、份数或备注。');
          statement=db.prepare(`UPDATE orders SET change_request=?,revision=revision+1 WHERE ${guard}`).bind(JSON.stringify({dish,quantity,note}),...values);
        }else if(action==='acceptChange'){
          if(!order.change_request)throw new UserError('当前没有待确认的改单申请。',409,'ORDER_CHANGED',room);
          if(body.confirmRestaurant!==true)throw new UserError('请先与餐馆核对可以修改，再确认改单。');
          const change=order.change_request;
          statement=db.prepare(`UPDATE orders SET dish=?,quantity=?,note=?,change_request=NULL,purchase_status='unplaced',issue_note='',revision=revision+1 WHERE ${guard}`).bind(change.dish,change.quantity,change.note,...values);
        }else if(action==='rejectChange'){
          if(!order.change_request)throw new UserError('当前没有待确认的改单申请。',409,'ORDER_CHANGED',room);
          statement=db.prepare(`UPDATE orders SET change_request=NULL,revision=revision+1 WHERE ${guard}`).bind(...values);
        }else if(action==='markSoldOut'){
          const issue=clean(body.issue,120,'售罄说明',false)||'菜品售罄，请选择替代菜品。';
          statement=db.prepare(`UPDATE orders SET purchase_status='sold_out',issue_note=?,revision=revision+1 WHERE ${guard}`).bind(issue,...values);
        }else{
          if(order.change_request)throw new UserError('请先处理改单申请，再确认下单。',409);
          statement=db.prepare(`UPDATE orders SET purchase_status='ordered',issue_note='',revision=revision+1 WHERE ${guard} AND change_request IS NULL`).bind(...values);
        }
        const [changed]=await db.batch([statement,db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND changes()>0').bind(id)]);
        const current=await roomState(db,id,owner);
        if(!changed.meta.changes)throw new UserError('登记或饭局状态已变化，请查看最新内容。',409,'ORDER_CHANGED',current);
        result=current;
      } else if (body.action==='order' || body.action==='editOrder' || body.action==='claim' || body.action==='deliver' || body.action==='release' || body.action==='cancelOrder') {
        const id=clean(body.room,64,'投票编号');
        const room=await roomState(db,id,owner);
        if(room.status!=='closed') throw new UserError('餐馆确定后才能登记带饭。',409);
        // Retrying the final delivery or an already accepted order remains safe after completion.
        const retryId=clean(body.orderId,64,'带饭编号');
        const submission=body.action==='order' ? orderSubmission(body) : undefined;
        if(await foodRetryAccepted(db,room,body.action,retryId,body.expectedRevision,submission)) result=room;
        else if(room.phase==='finished') throw mealFinishedError(room);
        else {
        let statement: D1PreparedStatement;
        let cancelledRequest: D1PreparedStatement | undefined;
        if(body.action==='order') {
          if(await db.prepare('SELECT id FROM cancelled_order_requests WHERE id=?').bind(retryId).first()) throw new UserError('这条登记已经取消，不能通过重试恢复。需要带饭时请重新填写一条新登记。',409,'ORDER_CANCELLED',room);
          if(room.orders_stopped_at) throw new UserError('本轮已停止加单，已有登记仍可继续认领和带回。',409,'ORDERS_STOPPED',room);
          const {nickname,dish,quantity,note}=submission!;
          const orderId=clean(body.orderId,64,'登记编号');
          if(!/^[a-f0-9-]{36}$/.test(orderId)) throw new UserError('登记编号无效。');
          // A client-generated request ID makes retrying a submitted order safe.
          statement=db.prepare(`INSERT OR IGNORE INTO orders (id,room_id,owner,nickname,dish,quantity,note,status,created_at,creation_request_hash) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE NOT EXISTS (SELECT 1 FROM cancelled_order_requests WHERE id=?) AND (SELECT COUNT(*) FROM orders WHERE room_id=?)<200 AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND orders_stopped_at IS NULL AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,owner,nickname,dish,quantity,note,new Date().toISOString(),await hashText(JSON.stringify(submission)),orderId,id,id);
        } else {
          const orderId=clean(body.orderId,64,'带饭编号');
          const order=room.orders.find(o=>o.id===orderId);
          if(!order) throw new UserError('这条带饭登记已取消，请刷新。',404);
          if(body.action==='editOrder' || body.action==='claim' || body.action==='deliver' || body.action==='release' || body.action==='cancelOrder') {
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
            // The tombstone and deletion share the same transaction and revision check.
            cancelledRequest=db.prepare(`INSERT OR IGNORE INTO cancelled_order_requests (id,room_id,owner,cancelled_at)
              SELECT id,room_id,owner,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM orders
              WHERE id=? AND room_id=? AND owner=? AND status='pending' AND revision=?
              AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,owner,body.expectedRevision,id);
            statement=db.prepare(`DELETE FROM orders WHERE id=? AND room_id=? AND owner=? AND status='pending' AND revision=? AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,owner,body.expectedRevision,id);
          } else {
            if(!order.canManage) throw new UserError('只有带饭人或本轮发起人可以操作。',403);
            if(order.change_request)throw new UserError('请先由带饭人处理改单申请。',409,'ORDER_CHANGED',room);
            if(body.action==='deliver'&&order.purchase_status==='sold_out')throw new UserError('菜品售罄，解决换菜并确认下单后才能标记带回。',409);
            if(body.action==='release'&&order.purchase_status==='ordered')throw new UserError('已经下单，不能直接退回认领。请先与餐馆和收餐人联系处理。',409);
            statement=body.action==='deliver' ? db.prepare(`UPDATE orders SET status='delivered',revision=revision+1 WHERE id=? AND room_id=? AND status='claimed' AND purchase_status<>'sold_out' AND change_request IS NULL AND revision=? AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?)) AND (?=1 OR EXISTS (SELECT 1 FROM orders other WHERE other.room_id=orders.room_id AND other.id<>orders.id AND other.status<>'delivered')) AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,body.expectedRevision,owner,id,owner,body.confirmFinish===true?1:0,id) : db.prepare(`UPDATE orders SET status='pending',purchase_status='unplaced',issue_note='',claimant=NULL,claimant_name=NULL,revision=revision+1 WHERE id=? AND room_id=? AND status='claimed' AND purchase_status<>'ordered' AND change_request IS NULL AND revision=? AND (claimant=? OR EXISTS(SELECT 1 FROM rooms WHERE id=? AND owner=?)) AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND ${ACTIVE_DELIVERY_SQL})`).bind(orderId,id,body.expectedRevision,owner,id,owner,id);
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
        const changed=await db.batch([previousParticipants,...(cancelledRequest?[cancelledRequest]:[]),statement,db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND deleted_at IS NULL').bind(id),recordParticipation(db,id,owner),
          ...(body.action==='order' || body.action==='claim' ? [db.prepare(`INSERT INTO visitor_preferences (owner,nickname,nickname_key)
            SELECT ?,${body.action==='order'?'nickname':'claimant_name'},? FROM orders WHERE id=? AND room_id=? AND ${body.action==='order'?'owner':'claimant'}=?
            ON CONFLICT(owner) DO NOTHING`).bind(owner,clean(body.nickname,24,'用户名').toLocaleLowerCase(),normalizedOrderId,id,owner)] : []),
          finishMeal(db,'id=?',[id])]);
        const current=await roomState(db,id,owner);
        if(!changed[cancelledRequest?2:1].meta.changes && !await foodRetryAccepted(db,current,body.action,normalizedOrderId,body.expectedRevision,submission)) {
          if(current.phase==='finished') throw mealFinishedError(current);
          const latest=current.orders.find(o=>o.id===normalizedOrderId);
          if(body.action==='order' && await db.prepare('SELECT id FROM cancelled_order_requests WHERE id=?').bind(normalizedOrderId).first()) throw new UserError('这条登记已经取消，请重新填写一条新登记。',409,'ORDER_CANCELLED',current);
          if(body.action==='order' && current.orders_stopped_at) throw new UserError('本轮刚刚停止加单，填写内容已保留。',409,'ORDERS_STOPPED',current);
          if((body.action==='deliver'||body.action==='release')&&latest?.revision!==body.expectedRevision) throw new UserError('这份登记或认领人已变化，请查看最新内容后重试。',409,'ORDER_CHANGED',current);
          if(body.action==='deliver' && body.confirmFinish!==true && latest?.status==='claimed' && latest.canManage && current.orders.filter(o=>o.status!=='delivered').length===1)
            throw new UserError('这是最后一份带饭，确认带回后本轮将结束。',409,'FINAL_DELIVERY_CONFIRM_REQUIRED',current);
          if(body.action==='editOrder' || body.action==='claim' || body.action==='cancelOrder') throw new UserError('这条登记刚被修改或认领，请查看最新内容后重试。',409,'ORDER_CHANGED',current);
          throw new UserError(body.action==='order' ? '本轮带饭清单已满，请在群里联系发起人。' : '这条登记刚被更新，请查看最新清单。',409);
        }
        result=current;
        }
      } else throw new UserError('未知操作。');
    }
    if(result&&typeof result==='object') {
      const currentProfile='profile' in result?result.profile as Profile:'nickname' in result&&'revision' in result?result as Profile:null;
      if(currentProfile){
        const returnTo='candidates' in result&&'id' in result?`/?room=${encodeURIComponent(String(result.id))}`:url.searchParams.has('history')?'/history':'/';
        currentProfile.account=identityResult.account;
        currentProfile.sign_in_path=identityResult.authAvailable?chatGPTSignInPath(returnTo):undefined;currentProfile.sign_out_path=identityResult.authAvailable?chatGPTSignOutPath(returnTo):undefined;
      }
    }
    const headers: Record<string,string>={'Cache-Control':'no-store','X-Fandian-Identity':viewKey};
    if(cookie) headers['Set-Cookie']=cookie;
    return Response.json(result,{headers});
  } catch(error) {
    if(error instanceof DraftError) error=new UserError(error.message,error.status,error.code,undefined,{draftState:error.state});
    if(error instanceof MenuError) error=new UserError(error.message,error.status);
    if(error instanceof PayloadTooLargeError) error=new UserError('提交内容过长。',413);
    if(error instanceof UserError&&error.room){error.room.profile.account=account;error.room.profile.sign_in_path=authAvailable?chatGPTSignInPath(`/?room=${encodeURIComponent(error.room.id)}`):undefined;error.room.profile.sign_out_path=authAvailable?chatGPTSignOutPath(`/?room=${encodeURIComponent(error.room.id)}`):undefined;}
    if(!(error instanceof UserError)) console.error('Fandian request failed',error);
    const headers: Record<string,string>={'Cache-Control':'no-store'};if(viewKey)headers['X-Fandian-Identity']=viewKey; if(cookie) headers['Set-Cookie']=cookie;
    return Response.json({error:error instanceof UserError ? error.message : '暂时连接不上，请稍后重试。你的填写内容仍然保留。',...(error instanceof UserError && error.code ? {code:error.code,room:error.room,...error.details} : {})},{status:error instanceof UserError ? error.status : 503,headers});
  }
}
export const GET=handle;
export const POST=handle;
