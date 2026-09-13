import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDatabase} from './sqlite-d1.mjs';
import {GET,POST} from '../src/app/api/game/route.ts';
import {parseOrderDraft} from '../src/lib/order-draft.ts';
import {mealShareText} from '../src/lib/meal-share.ts';

let db;
beforeEach(()=>{db=createDatabase();globalThis.__fandianTestDB=db;});
afterEach(()=>{db.sqlite.close();delete globalThis.__fandianTestDB;});
const visitor=()=>randomBytes(32).toString('hex');
async function call(who,body,query=''){
  if(body?.action==='saveRestaurant'&&body.id&&body.expectedRevision===undefined)body={...body,expectedRevision:(await call(who)).data.restaurants.find(r=>r.id===body.id)?.revision};
  const response=await(body?POST:GET)(new Request(`https://example.test/api/game${query}`,{method:body?'POST':'GET',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
}
async function create(who){const catalog=(await call(who)).data;const result=await call(who,{action:'create',title:'便捷功能测试',mode:'manual',requestId:randomUUID(),restaurantIds:catalog.restaurants.slice(0,2).map(r=>r.id)});assert.equal(result.status,200);return {catalog,room:result.data};}
async function delivery(host){const {room}=await create(host);await call(host,{action:'vote',room:room.id,nickname:'发起人',candidateId:room.candidates[0].id});return(await call(host,{action:'close',room:room.id})).data;}
async function order(who,room,nickname='收餐人'){const orderId=randomUUID();const result=await call(who,{action:'order',room:room.id,orderId,nickname,dish:'盒饭',quantity:2,note:'少辣'});assert.equal(result.status,200);return result.data.orders.find(o=>o.id===orderId);}
async function claim(who,room,o,nickname='带饭人'){const result=await call(who,{action:'claim',room:room.id,orderId:o.id,expectedRevision:o.revision,nickname});assert.equal(result.status,200);return result.data;}
const plan=(room,extra={})=>({action:'savePickupPlan',room:room.id,expectedRevision:0,time:'今天 18:30',place:'宿舍大厅',...extra});
const save=(r,extra={})=>({action:'saveRestaurant',id:r.id,name:r.name,cuisine:r.cuisine,address:r.address,...extra});

test('latest menu follows a stable restaurant identity through renames, preserving snapshots and replay',async()=>{
  const who=visitor(),{catalog,room}=await create(who),r=catalog.restaurants[0],candidate=room.candidates.find(c=>c.restaurant_id===r.id);
  assert.ok(candidate);const original=candidate.source;
  const changed=await call(who,save(r,{name:'改名后的餐馆',source:'https://new-menu.example/menu'}));assert.equal(changed.status,200);
  const latest=await call(visitor(),null,`?room=${room.id}&menu=${candidate.id}`);assert.equal(latest.status,200);assert.equal(latest.data.restaurant.name,'改名后的餐馆');assert.equal(latest.data.restaurant.source,'https://new-menu.example/menu');assert.ok(latest.data.restaurant.media_updated_at);
  const snapshot=(await call(who,null,`?room=${room.id}`)).data.candidates.find(c=>c.id===candidate.id);assert.equal(snapshot.name,r.name);assert.equal(snapshot.source,original);
  const replay=(await call(who,{action:'replay',room:room.id,requestId:randomUUID()})).data;assert.equal(replay.candidates[0].restaurant_id,room.candidates[0].restaurant_id);assert.equal(replay.candidates[0].source,room.candidates[0].source);
  assert.equal((await call(who,null,`?room=${room.id}&menu=wrong-candidate`)).status,404);
  await call(who,{action:'deleteRestaurant',id:r.id});assert.equal((await call(who,null,`?room=${room.id}&menu=${candidate.id}`)).data.restaurant,null);
  await call(who,{action:'restoreRestaurant',id:r.id});assert.equal((await call(who,null,`?room=${room.id}&menu=${candidate.id}`)).data.restaurant.id,r.id);
  await call(who,{action:'deleteRoom',room:room.id});assert.equal((await call(who,null,`?room=${room.id}&menu=${candidate.id}`)).status,404);
});
test('legacy menu matching is conservative when restaurant records are ambiguous',async()=>{
  const who=visitor(),{catalog,room}=await create(who),c=room.candidates[0],r=catalog.restaurants.find(r=>r.id===c.restaurant_id);
  db.sqlite.prepare('UPDATE candidates SET restaurant_id=NULL WHERE id=?').run(c.id);
  assert.equal((await call(who,null,`?room=${room.id}&menu=${c.id}`)).data.restaurant.id,r.id);
  await call(who,{...save(r),id:undefined,duplicateIds:[r.id]});
  const ambiguous=await call(who,null,`?room=${room.id}&menu=${c.id}`);assert.equal(ambiguous.status,200);assert.equal(ambiguous.data.restaurant,null);assert.match(ambiguous.data.message,/无法准确/);
});
test('personal pools are identity scoped, idempotent, revision checked and cannot be resurrected by retries',async()=>{
  const who=visitor(),other=visitor(),catalog=(await call(who)).data,ids=catalog.restaurants.slice(0,2).map(r=>r.id);
  const body={action:'savePool',name:'工作日午饭',restaurantIds:ids,requestId:randomUUID()};
  const first=await call(who,body);assert.equal(first.status,200);const pool=first.data.pools[0];assert.equal(pool.name,body.name);
  const copies=await Promise.all(Array.from({length:4},()=>call(who,body)));assert.ok(copies.every(r=>r.status===200&&r.data.pools.length===1));
  assert.deepEqual((await call(other)).data.pools,[]);
  assert.equal((await call(other,{...body,id:pool.id,expectedRevision:pool.revision})).status,404);
  assert.equal((await call(who,{...body,name:'不同的池'})).status,409);
  const edited=await call(who,{...body,id:pool.id,name:'午饭新名称',expectedRevision:pool.revision});assert.equal(edited.status,200);
  assert.equal((await call(who,{...body,id:pool.id,name:'旧窗口覆盖',expectedRevision:pool.revision})).status,409);
  assert.equal((await call(who,body)).data.pools[0].name,'午饭新名称');
  assert.equal((await call(other,{action:'deletePool',id:pool.id,expectedRevision:2})).status,409);
  assert.equal((await call(who,{action:'deletePool',id:pool.id,expectedRevision:2})).status,200);
  assert.equal((await call(who,body)).status,409);assert.deepEqual((await call(who)).data.pools,[]);
  assert.equal((await call(other,body)).status,200);
});
test('pools reject unavailable restaurants and concurrent writes cannot exceed the personal limit',async()=>{
  const who=visitor(),catalog=(await call(who)).data,ids=catalog.restaurants.slice(0,2).map(r=>r.id);
  const body={action:'savePool',name:'中餐',restaurantIds:ids};
  for(const restaurantIds of [[],[ids[0],ids[0]],[ids[0],'missing']])assert.ok((await call(who,{...body,restaurantIds,requestId:randomUUID()})).status>=400);
  for(let i=0;i<19;i++)assert.equal((await call(who,{...body,requestId:randomUUID()})).status,200);
  const last=await Promise.all([call(who,{...body,requestId:randomUUID()}),call(who,{...body,requestId:randomUUID()})]);assert.deepEqual(last.map(r=>r.status).sort(),[200,409]);assert.equal((await call(who)).data.pools.length,20);
  await call(who,{action:'deleteRestaurant',id:ids[0]});assert.equal((await call(visitor(),{...body,requestId:randomUUID()})).status,409);
  assert.equal((await call(who)).data.pools[0].restaurant_ids.length,2);
});
test('pickup plans belong to actual carriers, appear on every claimed order, and survive stopped intake',async()=>{
  const host=visitor(),guest=visitor(),carrier=visitor(),room=await delivery(host),a=await order(guest,room),b=await order(guest,room);
  assert.equal((await call(host,plan(room))).status,403);assert.equal((await call(guest,plan(room))).status,403);
  await claim(carrier,room,a);await claim(carrier,room,b);
  const saved=await call(carrier,plan(room,{owner:host}));assert.equal(saved.status,200);assert.equal(saved.data.myPickupPlan.revision,1);
  const guestView=(await call(guest,null,`?room=${room.id}`)).data;assert.ok(guestView.orders.every(o=>o.pickup_time==='今天 18:30'&&o.pickup_place==='宿舍大厅'));assert.equal(guestView.canEditPickupPlan,false);assert.equal(guestView.myPickupPlan.revision,0);
  await call(host,{action:'stopOrders',room:room.id});
  const changed=await call(carrier,plan(room,{expectedRevision:1,place:'图书馆门口'}));assert.equal(changed.status,200);assert.equal(changed.data.orders_stopped_at!==null,true);assert.equal(changed.data.delivery_deadline_at,room.delivery_deadline_at);
  assert.equal((await call(carrier,plan(room,{expectedRevision:1,place:'图书馆门口'}))).status,200);
  const stale=await call(carrier,plan(room,{expectedRevision:1,place:'旧地点'}));assert.equal(stale.status,409);assert.equal(stale.data.code,'PICKUP_CHANGED');assert.equal(stale.data.room.myPickupPlan.place,'图书馆门口');
});
test('concurrent pickup edits accept only one revision; release and new carrier do not leak previous plans',async()=>{
  const host=visitor(),guest=visitor(),a=visitor(),b=visitor(),room=await delivery(host),o=await order(guest,room);await claim(a,room,o);
  const concurrent=await Promise.all(['地点甲','地点乙'].map(place=>call(a,plan(room,{place}))));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const before=(await call(a,null,`?room=${room.id}`)).data.orders[0];const released=await call(a,{action:'release',room:room.id,orderId:o.id,expectedRevision:before.revision});assert.equal(released.status,200);assert.equal(released.data.orders[0].pickup_place,'');
  assert.equal((await call(a,plan(room,{expectedRevision:1,place:'新地点'}))).status,403);
  const next=await claim(b,room,released.data.orders[0],'新带饭人');assert.equal(next.orders[0].pickup_place,'');assert.equal(next.myPickupPlan.revision,0);
  assert.equal((await call(b,plan(room,{place:'新带饭人的地点'}))).status,200);
  const guestView=(await call(guest,null,`?room=${room.id}`)).data;assert.equal(guestView.orders[0].claimant_name,'新带饭人');assert.equal(guestView.orders[0].pickup_place,'新带饭人的地点');
  db.sqlite.prepare("UPDATE rooms SET decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-13 hours') WHERE id=?").run(room.id);
  assert.equal((await call(b,plan(room,{expectedRevision:1,place:'过期修改'}))).status,409);
});
test('latest migration preserves populated old rooms and menus',()=>{
  const legacy=createDatabase({migrationLimit:14});try{
    const now=new Date().toISOString();legacy.sqlite.prepare("INSERT INTO restaurants (id,owner,name,cuisine,selected,position) VALUES ('r','shared','旧店','中餐',1,0)").run();
    legacy.sqlite.prepare("INSERT INTO rooms (id,owner,title,status,created_at) VALUES ('room','owner','旧饭局','open',?)").run(now);
    legacy.sqlite.prepare("INSERT INTO candidates (id,room_id,name,cuisine,address,position,source,menu_images) VALUES ('c','room','旧店','中餐','',0,'https://old.example','[]')").run();
    legacy.sqlite.exec(readFileSync(new URL('../drizzle/0014_mighty_vindicator.sql',import.meta.url),'utf8'));
    const c=legacy.sqlite.prepare('SELECT * FROM candidates').get();assert.equal(c.source,'https://old.example');assert.equal(c.restaurant_id,null);assert.deepEqual(legacy.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{legacy.sqlite.close();}
});
test('incomplete order drafts survive serialization; malformed stored data is ignored',()=>{
  const draft={orderId:randomUUID(),nickname:'小李',dish:'',quantity:'',note:'少辣'};assert.deepEqual(parseOrderDraft(JSON.stringify(draft)),draft);
  for(const value of [null,'bad','[]',JSON.stringify({...draft,note:'字'.repeat(241)}),JSON.stringify({...draft,orderId:'bad'}),JSON.stringify({...draft,quantity:2})])assert.equal(parseOrderDraft(value),null);
});
test('group progress reflects fresh voting, pending quantities, pickup plans, stopped intake and completion',async()=>{
  const host=visitor(),guest=visitor(),carrier=visitor(),{room}=await create(host),url=`https://example.test/?room=${room.id}`;
  assert.match(mealShareText(room,url),/正在投票：0 人已投/);
  await call(host,{action:'vote',room:room.id,nickname:'发起人',candidateId:room.candidates[0].id});await call(host,{action:'close',room:room.id});
  const a=await order(guest,room),b=await order(guest,room);await claim(carrier,room,a);await call(carrier,plan(room));
  const stopped=(await call(host,{action:'stopOrders',room:room.id})).data;
  const text=mealShareText(stopped,url);assert.match(text,/待认领 1 条（2 份）/);assert.match(text,/正在带饭：带饭人/);assert.match(text,/宿舍大厅/);assert.match(text,/已停止加单/);assert.ok(text.endsWith(url));
  const expired=mealShareText(stopped,url,new Date(Date.parse(stopped.delivery_deadline_at)+1));assert.match(expired,/本轮已到期结束/);
  await claim(carrier,room,b);for(const original of [a,b]){const fresh=(await call(carrier,null,`?room=${room.id}`)).data;const o=fresh.orders.find(o=>o.id===original.id);assert.equal((await call(carrier,{action:'deliver',room:room.id,orderId:o.id,expectedRevision:o.revision,confirmFinish:true})).status,200);}
  const done=(await call(host,null,`?room=${room.id}`)).data;assert.match(mealShareText(done,url),/已全部带回，本轮结束/);
});
