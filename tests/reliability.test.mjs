import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {GET,POST} from '../src/app/api/game/route.ts';
import {similarRestaurants} from '../src/lib/restaurant-match.ts';
let db;
const visitor=()=>randomBytes(32).toString('hex');
beforeEach(()=>{db=createDatabase();globalThis.__fandianTestDB=db;});
afterEach(()=>{db.sqlite.close();delete globalThis.__fandianTestDB;});
async function call(who,body,query=''){
 const response=await(body?POST:GET)(new Request(`https://example.test/api/game${query}`,{method:body?'POST':'GET',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 return {status:response.status,data:await response.json()};
}
const edit=(r,extra={})=>({action:'saveRestaurant',id:r.id,expectedRevision:r.revision,name:r.name,cuisine:r.cuisine,address:r.address,source:r.source,menu_images:r.menu_images,...extra});
async function delivery(who){const catalog=(await call(who)).data;const room=(await call(who,{action:'create',title:'草稿验证',mode:'manual',requestId:randomUUID(),restaurantIds:catalog.restaurants.slice(0,2).map(r=>r.id)})).data;await call(who,{action:'vote',room:room.id,nickname:'发起人',candidateId:room.candidates[0].id});return(await call(who,{action:'close',room:room.id})).data;}
const draft=()=>({orderId:randomUUID(),nickname:'小李',dish:'宫保鸡丁',quantity:'2',note:'不要花生\n少辣',pending:false});
const saveDraft=(room,value,revision)=>({action:'saveOrderDraft',room:room.id,draft:value,expectedRevision:revision});
const getDraft=(who,room)=>call(who,null,`?room=${room.id}&draft=1`);

test('restaurant edits reject stale and revisionless clients, return latest media, and accept only one concurrent writer',async()=>{
 const a=visitor(),b=visitor(),r=(await call(a)).data.restaurants[0];
 const first=await call(a,edit(r,{source:'https://updated.example/menu'}));assert.equal(first.status,200);
 const stale=await call(b,edit(r,{address:'新地址'}));assert.equal(stale.status,409);assert.equal(stale.data.code,'RESTAURANT_CHANGED');assert.equal(stale.data.restaurant.source,'https://updated.example/menu');assert.equal(stale.data.restaurant.address,r.address);
 assert.equal((await call(b,edit(r,{expectedRevision:undefined}))).status,409);
 const fresh=stale.data.restaurant;const race=await Promise.all([call(a,edit(fresh,{address:'A'})),call(b,edit(fresh,{address:'B'}))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const final=(await call(a)).data.restaurants.find(x=>x.id===r.id);assert.equal(final.revision,2);assert.equal(final.source,'https://updated.example/menu');
 await call(a,{action:'deleteRestaurant',id:r.id});await call(a,{action:'restoreRestaurant',id:r.id});assert.equal((await call(b,edit(final))).status,409);
});
test('similar names prompt before adding and explicit branch acknowledgement permits a separate record',async()=>{
 const who=visitor(),r=(await call(who)).data.restaurants[0];
 const body={action:'saveRestaurant',name:'ＣＵＬＶＥＲＳ',address:'另一家分店'};
 const warning=await call(who,body);assert.equal(warning.status,409);assert.equal(warning.data.code,'RESTAURANT_DUPLICATE');assert.equal(warning.data.restaurants[0].id,r.id);
 assert.equal((await call(who,{...body,duplicateIds:[r.id]})).status,200);
 assert.equal((await call(who,{...body,duplicateIds:[r.id]})).status,409); // newly added matches must be acknowledged too
 assert.equal(similarRestaurants('Kung-Fu BBQ',[{id:'a',name:'Kung Fu BBQ（盒饭）'}]).length,1);
 assert.equal(similarRestaurants('另一家店',[r]).length,0);
});
test('private drafts survive new requests, keep incomplete fields, reject concurrent edits and clear without stale resurrection',async()=>{
 const who=visitor(),other=visitor(),room=await delivery(who),value={...draft(),dish:'',quantity:''};
 const body=saveDraft(room,value,0);assert.equal((await call(who,body)).status,200);assert.deepEqual((await getDraft(who,room)).data.draft,value);
 assert.deepEqual((await getDraft(other,room)).data,{draft:null,revision:0});
 assert.deepEqual((await call(who,body)).data,(await getDraft(who,room)).data); // lost save response
 const changes=await Promise.all([call(who,saveDraft(room,{...value,dish:'A'},1)),call(who,saveDraft(room,{...value,dish:'B'},1))]);assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
 const current=(await getDraft(who,room)).data;assert.equal((await call(who,{action:'clearOrderDraft',room:room.id,expectedRevision:current.revision})).status,200);
 assert.equal((await call(who,saveDraft(room,value,current.revision))).status,409);assert.equal((await getDraft(who,room)).data.draft,null);
 assert.equal((await call(other,saveDraft(room,{...value,nickname:'他人'},0))).status,200);assert.equal((await getDraft(who,room)).data.draft,null);
});
test('unresolved submissions keep their immutable ID, recover one order, and retire the saved draft after success or cancellation',async()=>{
 const who=visitor(),room=await delivery(who),value={...draft(),pending:true};
 const saved=await call(who,saveDraft(room,value,0));assert.equal(saved.status,200);
 assert.equal((await call(who,saveDraft(room,{...value,dish:'换菜'},saved.data.revision))).status,409);
 assert.equal((await call(who,{action:'clearOrderDraft',room:room.id,expectedRevision:saved.data.revision})).status,409);
 const payload={action:'order',room:room.id,...value,quantity:Number(value.quantity)};
 const first=await call(who,payload);assert.equal(first.status,200);assert.equal((await call(who,payload)).data.orders.length,1);
 assert.equal((await getDraft(who,room)).data.draft,null);
 const o=first.data.orders[0];assert.equal((await call(who,{action:'cancelOrder',room:room.id,orderId:o.id,expectedRevision:o.revision})).status,200);
 assert.equal((await call(who,payload)).status,409);assert.equal((await call(who,saveDraft(room,value,(await getDraft(who,room)).data.revision))).status,409);
});
test('draft validation and identity boundaries reject malformed and stale account writes',async()=>{
 const who=visitor(),room=await delivery(who);
 for(const bad of [{...draft(),note:'a'.repeat(241)},{...draft(),pending:true,quantity:''},{...draft(),pending:true,dish:'  '},{...draft(),orderId:'bad'}])assert.equal((await call(who,saveDraft(room,bad,0))).status,400);
 const response=await POST(new Request('https://example.test/api/game',{method:'POST',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':'application/json','X-Fandian-Identity':'stale'},body:JSON.stringify(saveDraft(room,draft(),0))}));assert.equal(response.status,409);
 assert.equal((await getDraft(who,room)).data.draft,null);
 await call(who,{action:'deleteRoom',room:room.id});assert.equal((await getDraft(who,room)).status,404);
});
test('new schema upgrades populated restaurant records without losing menus or existing orders',()=>{
 const old=createDatabase({migrationLimit:16});try{old.sqlite.prepare("INSERT INTO restaurants(id,owner,name,cuisine,address,source,menu_images,position) VALUES ('old','shared','老店','中餐','地址','https://menu.example','[\"menu\"]',0)").run();
 old.sqlite.exec(readFileSync(new URL('../drizzle/0016_light_zzzax.sql',import.meta.url),'utf8'));
 assert.equal(old.sqlite.prepare("SELECT revision FROM restaurants WHERE id='old'").get().revision,0);assert.equal(old.sqlite.prepare("SELECT menu_images FROM restaurants WHERE id='old'").get().menu_images,'["menu"]');assert.deepEqual(old.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{old.sqlite.close();}
});
