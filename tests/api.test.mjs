import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase } from './sqlite-d1.mjs';
import { GET, POST } from '../src/app/api/game/route.ts';

let db;
beforeEach(() => { db = createDatabase(); globalThis.__fandianTestDB = db; });
afterEach(() => { db.sqlite.close(); delete globalThis.__fandianTestDB; });
const visitor = () => randomBytes(32).toString('hex');
async function call(who, body, query = '') {
  const headers = { Cookie: `fd_session=${who}`, Origin: 'https://example.test' };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await (body ? POST : GET)(new Request(`https://example.test/api/game${query}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function create(who, mode = 'manual') {
  const catalog = (await call(who)).data;
  const payload = { action: 'create', title: '审查测试饭局', mode, requestId: randomUUID(), restaurantIds: catalog.restaurants.slice(0, 2).map(r => r.id) };
  const result = await call(who, payload); assert.equal(result.status, 200);
  return { room: result.data, payload };
}
async function delivery(who) {
  const { room } = await create(who);
  assert.equal((await call(who, { action: 'vote', room: room.id, nickname: '测试发起人', candidateId: room.candidates[0].id })).status, 200);
  const result = await call(visitor(), { action: 'close', room: room.id }); assert.equal(result.status, 200);
  return result.data;
}
const order = room => ({ action: 'order', room: room.id, orderId: randomUUID(), nickname: '测试食客', dish: '宫保鸡丁', quantity: 1, note: '少辣' });

test('fresh migrations preserve foreign keys and shared seed requirements', async () => {
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  const result = await call(visitor());
  assert.equal(result.data.restaurants.length, 6);
  assert.ok(result.data.restaurants.some(r => /Kung Fu BBQ/.test(r.name)));
  assert.ok(!result.data.restaurants.some(r => /Panda/i.test(r.name)));
  assert.match(result.headers.get('cache-control'), /no-store/);
});
test('create retries are atomic, scoped, fingerprinted, and cannot resurrect deletion', async () => {
  const host = visitor(), { room, payload } = await create(host);
  const copies = await Promise.all(Array.from({ length: 8 }, () => call(host, payload)));
  assert.ok(copies.every(r => r.status === 200 && r.data.id === room.id));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rooms').get().n, 1);
  assert.equal((await call(host, { ...payload, restaurantIds: [...payload.restaurantIds].reverse() })).status, 200);
  assert.equal((await call(host, { ...payload, title: '其他饭局' })).status, 409);
  const other = await call(visitor(), payload); assert.notEqual(other.data.id, room.id);
  assert.equal((await call(visitor(), { action: 'deleteRoom', room: room.id })).status, 404);
  await call(host, { action: 'deleteRoom', room: room.id });
  assert.equal((await call(host, payload)).status, 404);
  await call(host, { action: 'restoreRoom', room: room.id });
  assert.equal((await call(host, payload)).data.candidates.length, 2);
});
test('manual votes reject foreign candidates, duplicate visitors/nicknames, and close fixes winner', async () => {
  const host = visitor(), guest = visitor(), { room } = await create(host), second = (await create(host)).room;
  assert.equal((await call(guest, { action: 'close', room: room.id })).status, 400);
  assert.equal((await call(guest, { action: 'vote', room: room.id, nickname: '阿甲', candidateId: second.candidates[0].id })).status, 400);
  const payload = { action: 'vote', room: room.id, nickname: '阿甲', candidateId: room.candidates[1].id };
  const votes = await Promise.all([call(guest, payload), call(guest, payload)]);
  assert.ok(votes.every(r => r.status === 200 && r.data.total === 1));
  assert.equal((await call(visitor(), payload)).status, 409);
  const closed = (await call(visitor(), { action: 'close', room: room.id })).data;
  assert.equal(closed.winner_id, room.candidates[1].id);
  const retry = (await call(visitor(), { action: 'close', room: room.id })).data;
  assert.equal(retry.decided_at, closed.decided_at); assert.equal(retry.winner_id, closed.winner_id);
  assert.equal((await call(host, { ...payload, nickname: '阿乙' })).status, 409);
});
test('random mode ignores client candidate override and respects one vote', async () => {
  const who = visitor(), { room } = await create(who, 'random');
  const result = await call(who, { action: 'vote', room: room.id, nickname: '抽签', mode: 'manual', candidateId: 'invalid' });
  assert.equal(result.status, 200); assert.equal(result.data.total, 1);
  assert.ok(room.candidates.some(r => r.id === result.data.myVote.candidate_id));
});
test('200-voter bound survives two concurrent final votes', async () => {
  const { room } = await create(visitor());
  const insert = db.sqlite.prepare('INSERT INTO votes (id,room_id,voter,nickname,nickname_key,candidate_id,created_at) VALUES (?,?,?,?,?,?,?)');
  for (let i = 0; i < 199; i++) insert.run(randomUUID(), room.id, `v${i}`, `n${i}`, `n${i}`, room.candidates[0].id, new Date().toISOString());
  const results = await Promise.all(['最后甲', '最后乙'].map(nickname => call(visitor(), { action: 'vote', room: room.id, nickname, candidateId: room.candidates[0].id })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM votes WHERE room_id=?').get(room.id).n, 200);
});
test('order retry rejects altered payload but original retries survive edits, stop and completion', async () => {
  const host = visitor(), guest = visitor(), room = await delivery(host), payload = order(room);
  assert.equal((await call(guest, payload)).status, 200);
  const conflict = await call(guest, { ...payload, dish: '不同菜', quantity: 2 });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'ORDER_REQUEST_CONFLICT');
  assert.equal((await call(guest, { action: 'editOrder', room: room.id, orderId: payload.orderId, expectedRevision: 0, dish: '改后的菜', quantity: 2, note: '' })).status, 200);
  assert.equal((await call(guest, payload)).data.orders[0].dish, '改后的菜');
  await call(host, { action: 'stopOrders', room: room.id });
  assert.equal((await call(guest, payload)).status, 200);
  await call(host, { action: 'claim', room: room.id, orderId: payload.orderId, expectedRevision: 1, nickname: '带饭人' });
  const done = await call(host, { action: 'deliver', room: room.id, orderId: payload.orderId, expectedRevision: 2, confirmFinish: true });
  assert.equal(done.data.phase, 'finished'); assert.equal((await call(guest, payload)).status, 200);
  assert.equal((await call(guest, { ...payload, note: '不同备注' })).status, 409);
  assert.ok(!JSON.stringify(done.data).includes('creation_request_hash'));
});
test('cancel checks the exact pending revision and owner', async () => {
  const host = visitor(), guest = visitor(), room = await delivery(host), payload = order(room);
  await call(guest, payload);
  await call(guest, { action: 'editOrder', room: room.id, orderId: payload.orderId, expectedRevision: 0, dish: '新菜', quantity: 2, note: '' });
  const cancel = { action: 'cancelOrder', room: room.id, orderId: payload.orderId, expectedRevision: 0 };
  assert.equal((await call(guest, cancel)).data.code, 'ORDER_CHANGED');
  assert.equal((await call(guest, { ...cancel, expectedRevision: undefined })).status, 409);
  assert.equal((await call(host, { ...cancel, expectedRevision: 1 })).status, 403);
  assert.equal((await call(guest, { ...cancel, expectedRevision: 1 })).data.orders.length, 0);
});
test('legacy order retry is conservative and concurrent first submissions cannot silently conflict', async () => {
  const host=visitor(), room=await delivery(host), payload=order(room);
  const responses=await Promise.all([call(host,payload),call(host,{...payload,dish:'另一道菜'})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
  const stored=db.sqlite.prepare('SELECT * FROM orders').get();
  db.sqlite.prepare('UPDATE orders SET creation_request_hash=NULL').run();
  const original={...payload,dish:stored.dish};
  assert.equal((await call(host,original)).status,200);
  assert.equal((await call(host,{...original,quantity:4})).status,409);
});
test('concurrent edit and cancellation cannot both succeed from one revision', async () => {
  const host=visitor(), room=await delivery(host), payload=order(room);
  await call(host,payload);
  const results=await Promise.all([
    call(host,{action:'editOrder',room:room.id,orderId:payload.orderId,expectedRevision:0,dish:'新菜',quantity:1,note:''}),
    call(host,{action:'cancelOrder',room:room.id,orderId:payload.orderId,expectedRevision:0}),
  ]);
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.ok(results.some(r=>r.status===409||r.status===404));
});
test('late retries cannot recreate cancelled orders and stale cancels leave no tombstone', async () => {
  const host=visitor(), room=await delivery(host), payload=order(room);
  await call(host,payload);
  await call(host,{action:'editOrder',room:room.id,orderId:payload.orderId,expectedRevision:0,dish:'新菜',quantity:1,note:''});
  assert.equal((await call(host,{action:'cancelOrder',room:room.id,orderId:payload.orderId,expectedRevision:0})).status,409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM cancelled_order_requests').get().n,0);
  await call(host,{action:'cancelOrder',room:room.id,orderId:payload.orderId,expectedRevision:1});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM cancelled_order_requests').get().n,1);
  assert.equal((await call(host,payload)).data.code,'ORDER_CANCELLED');
  assert.equal((await call(host,undefined,`?room=${room.id}`)).data.orders.length,0);
  assert.equal((await call(host,{...payload,orderId:randomUUID()})).status,200);
});
test('stop intake enforces roles and clock, while existing orders still progress', async () => {
  const host = visitor(), guest = visitor(), carrier = visitor(), room = await delivery(host), payload = order(room);
  await call(guest, payload);
  assert.equal((await call(guest, { action: 'stopOrders', room: room.id })).status, 403);
  await call(carrier, { action: 'claim', room: room.id, orderId: payload.orderId, expectedRevision: 0, nickname: '带饭人' });
  const stopped = await call(carrier, { action: 'stopOrders', room: room.id });
  assert.ok(stopped.data.orders_stopped_at); assert.equal(stopped.data.phase, 'delivery');
  assert.equal(stopped.data.delivery_deadline_at, room.delivery_deadline_at);
  assert.equal((await call(guest, { ...payload, orderId: randomUUID() })).data.code, 'ORDERS_STOPPED');
  assert.equal((await call(carrier, { action: 'release', room: room.id, orderId: payload.orderId, expectedRevision: 0 })).status, 409);
  assert.equal((await call(carrier, { action: 'release', room: room.id, orderId: payload.orderId, expectedRevision: 1 })).status, 200);
  assert.equal((await call(guest, { action: 'editOrder', room: room.id, orderId: payload.orderId, expectedRevision: 2, dish: '仍可修改', quantity: 1, note: '' })).status, 200);
  const home = (await call(carrier)).data; assert.ok(home.activeRooms.find(r => r.id === room.id).orders_stopped_at);
});
test('last delivery requires confirmation and the exact successful retry remains idempotent', async () => {
  const host = visitor(), room = await delivery(host), payload = order(room);
  await call(host, payload);
  await call(host, { action: 'claim', room: room.id, orderId: payload.orderId, expectedRevision: 0, nickname: '带饭人' });
  const action = { action: 'deliver', room: room.id, orderId: payload.orderId, expectedRevision: 1 };
  assert.equal((await call(host, action)).data.code, 'FINAL_DELIVERY_CONFIRM_REQUIRED');
  const result = await call(host, { ...action, confirmFinish: true });
  assert.equal(result.data.phase, 'finished'); assert.equal(result.data.completion_reason, 'delivered');
  assert.equal((await call(host, action)).status, 200);
  assert.equal((await call(host, { ...action, expectedRevision: 0 })).status, 409);
});
test('timeout preserves unfinished states; stopping an empty meal does not end it', async () => {
  const host = visitor(), room = await delivery(host);
  const stopped = await call(host, { action: 'stopOrders', room: room.id }); assert.equal(stopped.data.phase, 'delivery');
  db.sqlite.prepare("UPDATE rooms SET decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 hours') WHERE id=?").run(room.id);
  const expired = (await call(host, undefined, `?room=${room.id}`)).data;
  assert.equal(expired.completion_reason, 'timeout'); assert.equal(expired.orders.length, 0);
});
test('participation history is isolated and hide/restore preserves original room', async () => {
  const host = visitor(), guest = visitor(), stranger = visitor(), { room } = await create(host);
  await call(guest, { action: 'vote', room: room.id, nickname: '访客', candidateId: room.candidates[0].id });
  assert.ok((await call(guest, undefined, '?history=active')).data.rooms.some(r => r.id === room.id && !r.isHost));
  assert.equal((await call(stranger, undefined, '?history=active')).data.rooms.length, 0);
  await call(guest, { action: 'removeHistory', room: room.id });
  assert.equal((await call(guest)).data.activeRooms.length, 0);
  assert.equal((await call(host, undefined, `?room=${room.id}`)).data.total, 1);
  await call(guest, { action: 'restoreHistory', room: room.id });
  assert.equal((await call(guest)).data.activeRooms.length, 1);
});
test('replay uses source snapshot, is idempotent and starts with empty state', async () => {
  const host = visitor(), room = await delivery(host);
  await call(host, { action: 'stopOrders', room: room.id });
  const payload = { action: 'replay', room: room.id, requestId: randomUUID() };
  const [a, b] = await Promise.all([call(host, payload), call(host, payload)]);
  assert.equal(a.data.id, b.data.id); assert.equal(a.data.mode, room.mode); assert.equal(a.data.phase, 'voting');
  assert.equal(a.data.orders_stopped_at, null); assert.equal(a.data.total, 0); assert.equal(a.data.orders.length, 0);
  assert.deepEqual(a.data.candidates.map(r => r.name), room.candidates.map(r => r.name));
});
test('API rejects cross-site requests, non-JSON types and malformed objects', async () => {
  for (const [headers, body, status] of [
    [{ Origin: 'https://other.test', 'Content-Type': 'application/json' }, '{}', 403],
    [{ 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, '{}', 403],
    [{ 'Content-Type': 'text/plain' }, '{}', 415],
    [{ 'Content-Type': 'application/json' }, '[]', 400],
    [{ 'Content-Type': 'application/json' }, '{broken', 400],
  ]) assert.equal((await POST(new Request('https://example.test/api/game', { method: 'POST', headers, body }))).status, status);
  const response = await GET(new Request('https://example.test/api/game'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax.*Secure/);
});

const rename = async (who,nickname,expectedRevision) => {
  const profile = (await call(who)).data.profile;
  return call(who,{action:'saveProfile',nickname,expectedRevision:expectedRevision??profile.revision});
};
test('profile persists, identifies the creator and participants, and changes only the current visitor', async () => {
  const host=visitor(),guest=visitor(),carrier=visitor();
  assert.equal((await call(host)).data.profile.nickname,'');assert.equal((await call(host)).data.profile.revision,0);
  const first=await rename(host,'  小李  ');assert.equal(first.status,200);assert.equal(first.data.nickname,'小李');
  const {room}=await create(host);
  assert.equal(room.creator_name,'小李');assert.equal(room.members[0].isHost,true);
  assert.equal((await call(host,{action:'vote',room:room.id,nickname:'旧表单名字',candidateId:room.candidates[0].id})).data.myVote.nickname,'小李');
  await call(guest,{action:'vote',room:room.id,nickname:'小王',candidateId:room.candidates[0].id});
  await call(host,{action:'close',room:room.id});
  const payload={...order(room),nickname:'小王'};await call(guest,payload);
  await call(carrier,{action:'claim',room:room.id,orderId:payload.orderId,expectedRevision:0,nickname:'小赵'});
  assert.equal((await rename(host,'李同学')).status,200);
  assert.equal((await rename(guest,'王同学')).status,200);
  assert.equal((await rename(carrier,'赵同学')).status,200);
  const fresh=(await call(guest,undefined,`?room=${room.id}`)).data;
  assert.equal(fresh.creator_name,'李同学');assert.deepEqual(fresh.votes.map(v=>v.nickname).sort(),['李同学','王同学']);
  assert.equal(fresh.orders[0].nickname,'王同学');assert.equal(fresh.orders[0].claimant_name,'赵同学');
  assert.equal(fresh.orders[0].revision,3);assert.equal(fresh.orders[0].status,'claimed');
  assert.equal(fresh.members.length,3);
  assert.equal(fresh.members.find(m=>m.isMe).nickname,'王同学');
  assert.equal(fresh.members.find(m=>m.nickname==='王同学').requests,1);
  assert.equal(fresh.members.find(m=>m.nickname==='赵同学').carrying,1);
  assert.equal((await call(host)).data.activeRooms[0].creator_name,'李同学');
  assert.equal((await call(guest,undefined,'?history=active')).data.rooms[0].creator_name,'李同学');
  const leak=JSON.stringify(fresh);assert.ok(!leak.includes('voter'));assert.ok(!leak.includes('"owner"'));assert.ok(!leak.includes(host));
  // A different visitor cannot select somebody else's identity via the request body.
  await call(carrier,{action:'saveProfile',nickname:'只改我',expectedRevision:1,owner:guest});
  assert.equal((await call(guest)).data.profile.nickname,'王同学');
});
test('nickname conflicts roll back profile and all records; stale profile updates do not overwrite', async () => {
  const a=visitor(),b=visitor(),{room}=await create(a);
  await call(a,{action:'vote',room:room.id,nickname:'Alice',candidateId:room.candidates[0].id});
  await call(b,{action:'vote',room:room.id,nickname:'Bob',candidateId:room.candidates[0].id});
  const before=(await call(a,undefined,`?room=${room.id}`)).data;
  assert.equal((await rename(a,'ＢＯＢ')).status,409);
  const unchanged=(await call(a,undefined,`?room=${room.id}`)).data;
  assert.equal(unchanged.revision,before.revision);assert.deepEqual(unchanged.profile,before.profile);assert.equal(unchanged.myVote.nickname,'Alice');
  const accepted=await rename(a,'Alex');assert.equal(accepted.status,200);
  assert.equal((await rename(a,'旧窗口',before.profile.revision)).status,409);
  assert.equal((await rename(a,'Alex',before.profile.revision)).status,200);
  assert.equal((await rename(a,'  ')).status,400);
  assert.equal((await rename(a,'字'.repeat(25))).status,400);
  assert.equal((await call(visitor(),{action:'saveProfile',nickname:'新用户',expectedRevision:-1})).status,409);
});
test('renaming requester or carrier invalidates old delivery confirmation but preserves original order retries', async () => {
  const host=visitor(),guest=visitor(),carrier=visitor(),room=await delivery(host),payload=order(room);
  await call(guest,payload);
  await call(carrier,{action:'claim',room:room.id,orderId:payload.orderId,expectedRevision:0,nickname:'帮带人'});
  const old={action:'deliver',room:room.id,orderId:payload.orderId,expectedRevision:1,confirmFinish:true};
  await rename(guest,'新收餐人');
  assert.equal((await call(carrier,old)).data.code,'ORDER_CHANGED');
  assert.equal((await call(guest,payload)).status,200);
  await rename(carrier,'新带饭人');
  assert.equal((await call(carrier,{...old,expectedRevision:2})).data.code,'ORDER_CHANGED');
  const current=(await call(carrier,undefined,`?room=${room.id}`)).data;
  const done=await call(carrier,{...old,expectedRevision:current.orders[0].revision});assert.equal(done.data.phase,'finished');
  await rename(guest,'收餐同学');
  const finished=(await call(carrier,undefined,`?room=${room.id}`)).data;
  assert.equal(finished.phase,'finished');assert.equal(finished.completed_at,done.data.completed_at);assert.equal(finished.orders[0].nickname,'收餐同学');
  assert.equal((await call(guest,payload)).status,200);
});
test('legacy order payloads and existing profiles survive migration and renaming', async () => {
  const host=visitor(),guest=visitor(),room=await delivery(host),payload=order(room);
  await call(guest,payload);
  db.sqlite.prepare('UPDATE orders SET creation_request_hash=NULL WHERE id=?').run(payload.orderId);
  await rename(guest,'新昵称');
  assert.equal((await call(guest,payload)).status,200);
  assert.equal((await call(guest,{...payload,nickname:'新昵称'})).status,409);
  assert.equal((await call(guest,undefined,`?room=${room.id}`)).data.orders[0].nickname,'新昵称');
});
test('concurrent renames use one accepted revision and concurrent voting keeps the canonical nickname', async () => {
  const host=visitor(),guest=visitor(),{room}=await create(host);
  await rename(guest,'原名');
  const attempts=await Promise.all(['甲同学','乙同学'].map(nickname=>rename(guest,nickname,1)));
  assert.equal(attempts.filter(r=>r.status===200).length,1);assert.equal(attempts.filter(r=>r.status===409).length,1);
  const current=(await call(guest)).data.profile;
  const [renamed,voted]=await Promise.all([
    rename(guest,'最终名字',current.revision),
    call(guest,{action:'vote',room:room.id,nickname:'过期名字',candidateId:room.candidates[0].id}),
  ]);
  assert.equal(renamed.status,200);assert.equal(voted.status,200);
  assert.equal((await call(guest,undefined,`?room=${room.id}`)).data.myVote.nickname,'最终名字');
});

test('upgrading a populated database preserves previous nicknames, orders, and history', async () => {
  const legacy=createDatabase({migrationLimit:11});
  try {
    const now=new Date().toISOString();
    legacy.sqlite.prepare('INSERT INTO visitor_preferences (owner,nickname) VALUES (?,?)').run('old-owner','原来的名字');
    legacy.sqlite.prepare("INSERT INTO rooms (id,owner,title,status,created_at) VALUES (?,?,?,'open',?)").run('old-room','old-owner','旧饭局',now);
    legacy.sqlite.prepare("INSERT INTO orders (id,room_id,owner,nickname,dish,quantity,note,status,created_at) VALUES (?,?,?,?,?,1,'','pending',?)").run('old-order','old-room','old-owner','原来的名字','原来的菜',now);
    legacy.sqlite.prepare('INSERT INTO room_history (owner,room_id,created_at) VALUES (?,?,?)').run('old-guest','old-room',now);
    const before=legacy.sqlite.prepare('SELECT * FROM orders').get();
    legacy.sqlite.exec(readFileSync(new URL('../drizzle/0011_eager_william_stryker.sql',import.meta.url),'utf8'));
    assert.deepEqual(legacy.sqlite.prepare('SELECT * FROM orders').get(),before);
    assert.equal(legacy.sqlite.prepare('SELECT nickname,revision FROM visitor_preferences').get().revision,0);
    assert.equal(legacy.sqlite.prepare('SELECT COUNT(*) n FROM room_history').get().n,1);
    assert.deepEqual(legacy.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
    legacy.sqlite.prepare("UPDATE visitor_preferences SET nickname='现在的名字',nickname_key='现在的名字',revision=1 WHERE owner='old-owner'").run();
    assert.equal(legacy.sqlite.prepare('SELECT revision FROM orders').get().revision,1);
    assert.equal(legacy.sqlite.prepare('SELECT nickname FROM orders').get().nickname,'原来的名字');
  } finally { legacy.sqlite.close(); }
});
