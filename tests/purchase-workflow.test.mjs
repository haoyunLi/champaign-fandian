import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDatabase} from './sqlite-d1.mjs';
import {GET,POST} from '../src/app/api/game/route.ts';
import {deadlineFromChampaign,champaignInput} from '../src/lib/voting-deadline.ts';
import {groupOrders,orderStatus} from '../src/lib/order-summary.ts';
import {mealShareText} from '../src/lib/meal-share.ts';
let db;
beforeEach(()=>{db=createDatabase();globalThis.__fandianTestDB=db;});
afterEach(()=>{db.sqlite.close();delete globalThis.__fandianTestDB;});
const user=()=>randomBytes(32).toString('hex');
async function call(who,body,query=''){
  if(body?.action==='saveRestaurant'&&body.id&&body.expectedRevision===undefined)body={...body,expectedRevision:(await call(who)).data.restaurants.find(r=>r.id===body.id)?.revision};
  const response=await(body?POST:GET)(new Request('https://example.test/api/game'+query,{method:body?'POST':'GET',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return {status:response.status,data:await response.json()};
}
async function create(who,extra={}){const c=(await call(who)).data,body={action:'create',requestId:randomUUID(),title:'体验流程测试',mode:'manual',restaurantIds:c.restaurants.slice(0,2).map(r=>r.id),...extra};const r=await call(who,body);assert.equal(r.status,200,JSON.stringify(r.data));return {room:r.data,body};}
async function delivery(host){const {room}=await create(host);await call(host,{action:'vote',room:room.id,nickname:'发起人',candidateId:room.candidates[0].id});return(await call(host,{action:'close',room:room.id})).data;}
const get=async(who,room)=>(await call(who,null,`?room=${room.id}`)).data;
async function add(who,room,extra={}){const body={action:'order',room:room.id,orderId:randomUUID(),nickname:'收餐人',dish:'宫保鸡丁',quantity:2,note:'少辣',...extra};const r=await call(who,body);assert.equal(r.status,200);return {order:r.data.orders.find(o=>o.id===body.orderId),body};}
async function own(who,room,o){const r=await call(who,{action:'claim',room:room.id,orderId:o.id,expectedRevision:o.revision,nickname:'带饭人'});assert.equal(r.status,200);return r.data.orders.find(x=>x.id===o.id);}
const action=(name,room,o,extra={})=>({action:name,room:room.id,orderId:o.id,expectedRevision:o.revision,...extra});

test('only the actual carrier can mark orders; ordered claims cannot be silently released or edited',async()=>{
  const host=user(),guest=user(),carrier=user(),room=await delivery(host),{order}=await add(guest,room);let o=await own(carrier,room,order);
  for(const who of [guest,host,user()])assert.equal((await call(who,action('markOrdered',room,o))).status,403);
  const saved=await call(carrier,action('markOrdered',room,o));assert.equal(saved.status,200);o=saved.data.orders[0];assert.equal(o.purchase_status,'ordered');assert.equal(o.status,'claimed');
  assert.equal((await call(carrier,action('release',room,o))).status,409);
  assert.equal((await call(guest,action('editOrder',room,o,{dish:'新菜',quantity:1,note:''}))).status,409);
  assert.equal((await call(guest,action('cancelOrder',room,o))).status,409);
  const home=(await call(guest)).data.activeRooms[0];assert.equal(home.my_orders[0].purchase_status,'ordered');assert.equal(home.my_orders[0].claimant_name,'带饭人');
  assert.equal((await call(host)).data.activeRooms[0].my_orders.length,0);
});
test('sold-out food cannot be delivered; owner requests a change and carrier confirms the restaurant before replacement',async()=>{
  const host=user(),guest=user(),carrier=user(),room=await delivery(host),{order,body}=await add(guest,room);let o=await own(carrier,room,order);
  o=(await call(carrier,action('markOrdered',room,o))).data.orders[0];
  o=(await call(carrier,action('markSoldOut',room,o,{issue:'鸡肉卖完，可以换牛肉'}))).data.orders[0];assert.equal(o.purchase_status,'sold_out');
  assert.equal((await call(carrier,action('deliver',room,o,{confirmFinish:true}))).status,409);
  await call(host,{action:'stopOrders',room:room.id});
  const replacement={dish:'牛肉饭',quantity:3,note:'不辣，花生过敏'};
  assert.equal((await call(host,action('requestChange',room,o,replacement))).status,403);
  const pending=await call(guest,action('requestChange',room,o,replacement));assert.equal(pending.status,200);o=pending.data.orders[0];assert.equal(o.dish,'宫保鸡丁');assert.deepEqual(o.change_request,{...replacement,note:replacement.note.normalize('NFKC')});
  assert.equal((await call(carrier,action('markOrdered',room,o))).status,409);
  assert.equal((await call(carrier,action('release',room,o))).status,409);
  assert.equal((await call(host,action('acceptChange',room,o,{confirmRestaurant:true}))).status,403);
  assert.equal((await call(carrier,action('acceptChange',room,o))).status,400);
  const accepted=await call(carrier,action('acceptChange',room,o,{confirmRestaurant:true}));assert.equal(accepted.status,200);o=accepted.data.orders[0];assert.equal(o.dish,'牛肉饭');assert.equal(o.purchase_status,'unplaced');assert.equal(o.change_request,null);assert.equal(o.issue_note,'');assert.equal(accepted.data.delivery_deadline_at,room.delivery_deadline_at);
  assert.equal((await call(guest,body)).data.orders[0].dish,'牛肉饭');
  o=(await call(carrier,action('markOrdered',room,o))).data.orders[0];const done=await call(carrier,action('deliver',room,o,{confirmFinish:true}));assert.equal(done.data.phase,'finished');
});
test('stale change approvals cannot overwrite a revised request, and rejecting retains original purchased food',async()=>{
  const host=user(),guest=user(),carrier=user(),room=await delivery(host),{order}=await add(guest,room);let o=await own(carrier,room,order);
  o=(await call(carrier,action('markOrdered',room,o))).data.orders[0];
  o=(await call(guest,action('requestChange',room,o,{dish:'第一次换菜',quantity:1,note:''}))).data.orders[0];const old=o;
  o=(await call(guest,action('requestChange',room,o,{dish:'更新后的换菜',quantity:1,note:''}))).data.orders[0];
  const stale=await call(carrier,action('acceptChange',room,old,{confirmRestaurant:true}));assert.equal(stale.status,409);assert.equal(stale.data.room.orders[0].change_request.dish,'更新后的换菜');
  const no=await call(carrier,action('rejectChange',room,o));assert.equal(no.status,200);assert.equal(no.data.orders[0].dish,'宫保鸡丁');assert.equal(no.data.orders[0].purchase_status,'ordered');assert.equal(no.data.orders[0].change_request,null);
  assert.ok((await get(guest,room)).notifications.some(n=>n.message.includes('未接受改单')));
});
test('racing change and delivery cannot both succeed; lifecycle forbids purchasing after timeout',async()=>{
  const host=user(),guest=user(),carrier=user(),room=await delivery(host),{order}=await add(guest,room),o=await own(carrier,room,order);
  const outcomes=await Promise.all([call(carrier,action('deliver',room,o,{confirmFinish:true})),call(guest,action('requestChange',room,o,{dish:'换菜',quantity:1,note:''}))]);assert.equal(outcomes.filter(r=>r.status===200).length,1);
  db.sqlite.prepare("UPDATE rooms SET decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 hours') WHERE id=?").run(room.id);
  const current=await get(carrier,room);assert.equal((await call(carrier,action('markSoldOut',room,current.orders[0]))).status,409);
});
test('persistent personal updates are private and acknowledge only the observed IDs; failed writes create no notices',async()=>{
  const host=user(),guest=user(),carrier=user(),other=user(),room=await delivery(host),{order}=await add(guest,room);let o=await own(carrier,room,order);
  const initial=await get(guest,room);assert.ok(initial.notifications.some(n=>n.message.includes('已认领')));const throughId=Math.max(...initial.notifications.map(n=>n.id));
  assert.deepEqual((await call(other)).data.notifications,[]);
  await call(other,{action:'readUpdates',throughId});assert.equal((await get(guest,room)).notifications.length,initial.notifications.length);
  await call(carrier,{action:'savePickupPlan',room:room.id,expectedRevision:0,time:'今天 12:30',place:'大厅'});
  const home=(await call(guest)).data;assert.equal(home.activeRooms[0].my_orders[0].pickup_time,'今天 12:30');assert.ok(home.notifications.some(n=>n.message.includes('大厅')));
  const before=home.notifications.length;assert.equal((await call(carrier,{action:'savePickupPlan',room:room.id,expectedRevision:0,time:'今天 12:40',place:'旧窗口'})).status,409);assert.equal((await call(guest)).data.notifications.length,before);
  await call(guest,{action:'readUpdates',throughId});const remaining=(await call(guest)).data.notifications;assert.ok(remaining.length>0);assert.ok(remaining.every(n=>n.id>throughId));
  assert.ok(!JSON.stringify(home.notifications).includes('"owner"'));
  o=(await call(guest,action('requestChange',room,o,{dish:'别的菜',quantity:1,note:''}))).data.orders[0];assert.ok((await call(carrier)).data.notifications.some(n=>n.message.includes('申请修改')));
  assert.equal(o.change_request.dish,'别的菜');
});
test('dish grouping preserves exact notes and all recipients instead of merging dietary differences',()=>{
  const base={dish:'宫保鸡丁',quantity:1,note:'少辣',nickname:'甲'};
  const groups=groupOrders([base,{...base,nickname:'乙',quantity:2},{...base,nickname:'丙',note:'不辣'},{...base,nickname:'丁',note:'少辣，花生过敏'},{...base,dish:'鱼香肉丝'}]);
  assert.equal(groups.length,4);assert.equal(groups[0].quantity,3);assert.deepEqual(groups[0].recipients,[{name:'甲',quantity:1},{name:'乙',quantity:2}]);assert.equal(groups[2].note,'少辣，花生过敏');
  assert.match(orderStatus({status:'claimed',purchase_status:'sold_out',claimant_name:'甲'}),/需要换菜/);
});
test('last dishes are owner scoped, restaurant scoped, latest first, and survive restaurant renaming',async()=>{
  const host=user(),guest=user(),stranger=user(),room=await delivery(host);
  await add(guest,room,{dish:'旧菜',note:'少辣'});await add(guest,room,{dish:'新菜',note:'不要花生'});
  // Make time ordering deterministic instead of relying on millisecond creation ties.
  db.sqlite.prepare("UPDATE orders SET created_at='2020-01-01T00:00:00.000Z' WHERE dish='旧菜'").run();
  const catalog=(await call(host)).data,r=catalog.restaurants.find(r=>r.id===room.candidates[0].restaurant_id);await call(host,{action:'saveRestaurant',id:r.id,name:'改名后的店',cuisine:r.cuisine,address:r.address});
  const replay=(await call(host,{action:'replay',room:room.id,requestId:randomUUID()})).data;
  await call(host,{action:'vote',room:replay.id,nickname:'发起人',candidateId:replay.candidates[0].id});await call(host,{action:'close',room:replay.id});
  const mine=await get(guest,replay);assert.deepEqual(mine.recentDishes.map(r=>r.dish),['新菜','旧菜']);assert.equal(mine.recentDishes[0].note,'不要花生');assert.deepEqual((await get(stranger,replay)).recentDishes,[]);
  // Old meals without a restaurant ID can match only an unambiguous current record.
  db.sqlite.prepare("UPDATE candidates SET restaurant_id=NULL WHERE room_id=?").run(room.id);
  const renamed={action:'saveRestaurant',id:r.id,name:r.name,cuisine:r.cuisine,address:r.address};await call(host,renamed);
  assert.deepEqual((await get(guest,replay)).recentDishes.map(r=>r.dish),['新菜','旧菜']);
  await call(host,{...renamed,id:undefined,duplicateIds:[r.id]});assert.deepEqual((await get(guest,replay)).recentDishes,[]);
  const other=(await create(host,{restaurantIds:catalog.restaurants.slice(2,4).map(r=>r.id)})).room;await call(host,{action:'vote',room:other.id,nickname:'发起人',candidateId:other.candidates[0].id});await call(host,{action:'close',room:other.id});assert.deepEqual((await get(guest,other)).recentDishes,[]);
});
test('voting deadlines preserve idempotent create requests and reject invalid or expired first creation',async()=>{
  const who=user(),deadline=new Date(Date.now()+3600000).toISOString(),{room,body}=await create(who,{votingDeadlineAt:deadline});assert.equal(room.voting_deadline_at,deadline);assert.equal((await call(who,body)).data.id,room.id);
  assert.equal((await call(who,{...body,votingDeadlineAt:new Date(Date.now()+7200000).toISOString()})).status,409);
  for(const votingDeadlineAt of ['bad','2020-01-01T00:00:00.000Z',new Date(Date.now()+15*86400000).toISOString()])assert.equal((await call(who,{...body,requestId:randomUUID(),votingDeadlineAt})).status,400);
  db.sqlite.prepare("UPDATE rooms SET voting_deadline_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(room.id);assert.equal((await call(who,body)).status,200);
});
test('deadline settles once with highest votes; exact cutoff starts the delivery clock and prevents late voting',async()=>{
  const host=user(),{room}=await create(host,{votingDeadlineAt:new Date(Date.now()+3600000).toISOString()});
  for(let i=0;i<3;i++)await call(user(),{action:'vote',room:room.id,nickname:'食客'+i,candidateId:room.candidates[i===0?1:0].id});
  const cutoff=new Date(Date.now()-1000).toISOString();db.sqlite.prepare('UPDATE rooms SET voting_deadline_at=? WHERE id=?').run(cutoff,room.id);
  const results=await Promise.all(Array.from({length:6},()=>get(user(),room)));assert.ok(results.every(r=>r.winner_id===room.candidates[0].id&&r.decided_at===cutoff&&r.phase==='delivery'));
  assert.equal(Date.parse(results[0].delivery_deadline_at),Date.parse(cutoff)+12*3600000);
  assert.equal((await call(user(),{action:'vote',room:room.id,nickname:'迟到',candidateId:room.candidates[0].id})).status,409);
  const early=(await create(host,{votingDeadlineAt:new Date(Date.now()+3600000).toISOString()})).room;await call(host,{action:'vote',room:early.id,nickname:'主人',candidateId:early.candidates[1].id});assert.equal((await call(user(),{action:'close',room:early.id})).data.winner_id,early.candidates[1].id);
});
test('zero-vote expiry has no winner or delivery phase and remains visible in history and share text',async()=>{
  const host=user(),{room}=await create(host,{votingDeadlineAt:new Date(Date.now()+3600000).toISOString()});const cutoff=new Date(Date.now()-1000).toISOString();db.sqlite.prepare('UPDATE rooms SET voting_deadline_at=? WHERE id=?').run(cutoff,room.id);
  const home=(await call(host)).data;assert.equal(home.activeRooms.length,0);assert.equal(home.rooms[0].completion_reason,'no_votes');
  const fresh=await get(host,room);assert.equal(fresh.winner_id,null);assert.equal(fresh.decided_at,null);assert.equal(fresh.delivery_deadline_at,null);assert.equal(fresh.phase,'finished');assert.equal(fresh.completed_at,cutoff);
  assert.equal((await call(user(),{action:'close',room:room.id})).data.completion_reason,'no_votes');
  assert.equal((await call(host,null,'?history=active')).data.rooms[0].completion_reason,'no_votes');assert.match(mealShareText(fresh,'https://example.test'),/未产生结果/);
  const replay=(await call(host,{action:'replay',room:room.id,requestId:randomUUID()})).data;assert.equal(replay.phase,'voting');assert.equal(replay.voting_deadline_at,null);
  assert.equal((await call(host,{action:'order',room:room.id,orderId:randomUUID(),nickname:'甲',dish:'饭',quantity:1,note:''})).status,409);
});
test('database boundary rejects a vote that crossed its deadline after the initial read',async()=>{
  const who=user(),{room}=await create(who,{votingDeadlineAt:new Date(Date.now()+3600000).toISOString()}),batch=db.batch.bind(db);let injected=false;
  db.batch=async statements=>{if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO votes'))){injected=true;db.sqlite.prepare("UPDATE rooms SET voting_deadline_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 seconds') WHERE id=?").run(room.id);}return batch(statements);};
  const result=await call(who,{action:'vote',room:room.id,nickname:'边界票',candidateId:room.candidates[0].id});assert.equal(injected,true);assert.equal(result.status,409);assert.equal((await get(who,room)).total,0);assert.equal((await get(who,room)).completion_reason,'no_votes');
});
test('Champaign deadline input respects daylight saving and rejects skipped or ambiguous local minutes',()=>{
  assert.equal(deadlineFromChampaign('2026-07-01T12:00'),'2026-07-01T17:00:00.000Z');assert.equal(deadlineFromChampaign('2026-12-01T12:00'),'2026-12-01T18:00:00.000Z');
  assert.equal(champaignInput(new Date('2026-12-01T18:00:00Z')),'2026-12-01T12:00');assert.equal(deadlineFromChampaign(''),null);
  for(const value of ['2026-03-08T02:30','2026-11-01T01:30','2026-02-31T12:00','bad'])assert.throws(()=>deadlineFromChampaign(value));
});
test('upgrade keeps existing orders, menus and meals while defaulting purchase tracking without generating old notifications',()=>{
  const old=createDatabase({migrationLimit:15});try{
    old.sqlite.prepare("INSERT INTO rooms(id,owner,title,status,created_at) VALUES('r','owner','旧饭局','closed','2020-01-01')").run();
    old.sqlite.prepare("INSERT INTO orders(id,room_id,owner,nickname,dish,quantity,status,created_at) VALUES('o','r','owner','甲','旧菜',2,'claimed','2020-01-01')").run();
    old.sqlite.exec(readFileSync(new URL('../drizzle/0015_low_bloodstorm.sql',import.meta.url),'utf8'));
    const row=old.sqlite.prepare('SELECT * FROM orders').get();assert.equal(row.dish,'旧菜');assert.equal(row.status,'claimed');assert.equal(row.purchase_status,'unplaced');assert.equal(row.change_request,null);assert.equal(old.sqlite.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);assert.deepEqual(old.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{old.sqlite.close();}
});
