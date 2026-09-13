import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase } from './sqlite-d1.mjs';
import { GET, POST } from '../src/app/api/game/route.ts';
import { GET as imageGet, POST as imagePost } from '../src/app/api/menu-images/route.ts';
import { MAX_MENU_BYTES } from '../src/lib/restaurant-media.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=','base64');
const visitor=()=>randomBytes(32).toString('hex');
let db, objects, puts;
beforeEach(()=>{
  db=createDatabase();globalThis.__fandianTestDB=db;objects=new Map();puts=0;
  globalThis.__fandianTestBucket={
    async put(key,bytes){puts++;objects.set(key,new Uint8Array(bytes));},
    async get(key){const bytes=objects.get(key);return bytes?{body:new Response(bytes).body}:null;},
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);},
  };
});
afterEach(()=>{db.sqlite.close();delete globalThis.__fandianTestDB;delete globalThis.__fandianTestBucket;});
async function call(who,body,query=''){
  if(body?.action==='saveRestaurant'&&body.id&&body.expectedRevision===undefined)body={...body,expectedRevision:(await call(who)).data.restaurants.find(r=>r.id===body.id)?.revision};
  const response=await(body?POST:GET)(new Request(`https://example.test/api/game${query}`,{method:body?'POST':'GET',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
}
async function upload(who,{body=png,type='image/png',id=randomUUID(),headers={}}={}){
  const response=await imagePost(new Request(`https://example.test/api/menu-images?request=${id}`,{method:'POST',headers:{Cookie:`fd_session=${who}`,Origin:'https://example.test','Content-Type':type,...headers},body,...(body instanceof ReadableStream?{duplex:'half'}:{})}));
  return {status:response.status,data:await response.json()};
}
const view=(who,id)=>imageGet(new Request(`https://example.test/api/menu-images?id=${id}`,{headers:{Cookie:`fd_session=${who}`}}));
const save=(restaurant,extra={})=>({action:'saveRestaurant',id:restaurant.id,name:restaurant.name,cuisine:restaurant.cuisine,address:restaurant.address,...extra});

test('menus become shared only after saving; website and menu snapshots survive edit, delete and replay',async()=>{
  const owner=visitor(),other=visitor();const catalog=(await call(owner)).data;const r=catalog.restaurants[0];
  const uploaded=await upload(owner);assert.equal(uploaded.status,200);const id=uploaded.data.id;
  assert.equal((await view(other,id)).status,404);
  const privateImage=await view(owner,id);assert.equal(privateImage.status,200);assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()),png);
  assert.equal((await call(other,save(r,{menu_images:[id]}))).status,409);
  const saved=await call(owner,save(r,{source:'https://restaurant.example/menu?a=1&b=2',menu_images:[id]}));assert.equal(saved.status,200);
  const image=await view(other,id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');
  const room=(await call(other,{action:'create',title:'菜单快照',mode:'manual',requestId:randomUUID(),restaurantIds:catalog.restaurants.slice(0,2).map(r=>r.id)})).data;
  assert.deepEqual(room.candidates[0].menu_images,[id]);assert.equal(room.candidates[0].source,'https://restaurant.example/menu?a=1&b=2');
  const newImage=(await upload(owner)).data.id;
  await call(owner,save(r,{menu_images:[newImage]}));
  const latest=(await call(other,null,`?room=${room.id}&menu=${room.candidates[0].id}`)).data;
  assert.deepEqual(latest.restaurant.menu_images,[newImage]);
  assert.deepEqual((await call(other,null,`?room=${room.id}`)).data.candidates[0].menu_images,[id]);
  assert.equal((await call(other,save(r,{source:'',menu_images:[]}))).status,200);
  await call(owner,{action:'deleteRestaurant',id:r.id});
  const reread=(await call(other,null,`?room=${room.id}`)).data;assert.deepEqual(reread.candidates[0].menu_images,[id]);assert.equal((await view(other,id)).status,200);
  const replay=(await call(other,{action:'replay',room:room.id,requestId:randomUUID()})).data;assert.deepEqual(replay.candidates[0].menu_images,[id]);
});
test('website validation rejects executable URLs; old clients preserve new fields and explicit clears work',async()=>{
  const who=visitor(),r=(await call(who)).data.restaurants[0],id=(await upload(who)).data.id;
  for(const source of ['javascript:alert(1)','data:text/html,test','//example.com','https://user:password@example.com','file:///tmp/menu','x'.repeat(2049)])assert.equal((await call(who,save(r,{source}))).status,400);
  await call(who,save(r,{source:'https://restaurant.example',menu_images:[id]}));
  const legacy=(await call(who,save(r,{name:'新名称'}))).data.restaurants.find(x=>x.id===r.id);
  assert.equal(legacy.source,'https://restaurant.example/');assert.deepEqual(legacy.menu_images,[id]);
  const cleared=(await call(who,save(r,{source:'',menu_images:[]}))).data.restaurants.find(x=>x.id===r.id);assert.equal(cleared.source,'');assert.deepEqual(cleared.menu_images,[]);
  assert.equal((await call(who,{action:'saveRestaurant',name:'新店',source:'https://new.example',menu_images:[id]})).status,200);
});
test('image validation rejects SVG, disguised content, oversized declarations and streamed bodies',async()=>{
  const who=visitor();
  assert.equal((await upload(who,{body:'<svg/>',type:'image/svg+xml'})).status,415);
  assert.equal((await upload(who,{body:'<html>bad</html>'})).status,415);
  assert.equal((await upload(who,{type:'image/jpeg'})).status,415);
  assert.equal((await upload(who,{headers:{'Content-Length':String(MAX_MENU_BYTES+1)}})).status,413);
  let cancelled=false;
  const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
  assert.equal((await upload(who,{body})).status,413);assert.equal(cancelled,true);
  assert.equal(objects.size,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM menu_images').get().n,0);
});
test('upload retries reuse the same object, reject changed content, and recover a storage failure',async()=>{
  const who=visitor(),id=randomUUID(),first=await upload(who,{id});
  assert.equal(first.status,200);assert.deepEqual(await upload(who,{id}),first);assert.equal(puts,1);
  const changed=Buffer.from(png);changed[40]^=1;assert.equal((await upload(who,{id,body:changed})).status,409);
  const bucket=globalThis.__fandianTestBucket,put=bucket.put;bucket.put=async()=>{throw new Error('synthetic storage failure');};
  const second=randomUUID(),log=console.error;console.error=()=>{};
  try{assert.equal((await upload(who,{id:second})).status,503);}finally{console.error=log;bucket.put=put;}
  assert.equal((await upload(who,{id:second})).status,200);assert.equal(objects.size,2);
});
test('invalid references cannot attach, stale drafts expire, and saved historical images remain available',async()=>{
  const who=visitor(),r=(await call(who)).data.restaurants[0],id=(await upload(who)).data.id;
  for(const menu_images of [[id,id],Array.from({length:7},()=>randomBytes(16).toString('hex')),['../bad'],[randomBytes(16).toString('hex')]])assert.ok((await call(who,save(r,{menu_images}))).status>=400);
  const saved=(await upload(who)).data.id;await call(who,save(r,{menu_images:[saved]}));
  db.sqlite.prepare("UPDATE menu_images SET created_at='2020-01-01T00:00:00.000Z'").run();
  await upload(who);assert.equal((await view(who,id)).status,404);assert.equal(objects.has(`menus/${id}`),false);assert.equal((await view(visitor(),saved)).status,200);
  assert.equal((await call(who,save(r,{menu_images:[id]}))).status,409);
  assert.deepEqual((await call(who)).data.restaurants[0].menu_images,[saved]);
});
test('upload origin and identity checks reject stale or cross-site writes before storage',async()=>{
  const who=visitor();assert.equal((await upload(who,{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await upload(who,{headers:{'X-Fandian-Identity':'old-view'}})).status,409);
  assert.equal(objects.size,0);
});
test('unpublished upload limit is bounded and saving a menu frees draft slots',async()=>{
  const who=visitor(),ids=[];for(let i=0;i<12;i++){const result=await upload(who);assert.equal(result.status,200);ids.push(result.data.id);}
  assert.equal((await upload(who)).status,429);
  const r=(await call(who)).data.restaurants[0];assert.equal((await call(who,save(r,{menu_images:ids.slice(0,6)}))).status,200);
  assert.equal((await upload(who)).status,200);
});
