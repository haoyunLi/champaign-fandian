import { test,beforeEach,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createDatabase } from './sqlite-d1.mjs';
import { GET,POST } from '../src/app/api/game/route.ts';
let db;
beforeEach(()=>{db=createDatabase();globalThis.__fandianTestDB=db;});
afterEach(()=>{db.sqlite.close();delete globalThis.__fandianTestDB;});
const browser=()=>randomBytes(32).toString('hex');
const person=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':`${id}@example.test`});
async function request(cookie,body,{user,view,query='',headers={}}={}) {
  const h={Origin:'https://champaign-fandian.haoyun963.chatgpt.site',...(cookie?{Cookie:`fd_session=${cookie}`}:{}) ,...(user?person(user):{}),...headers};
  if(body)h['Content-Type']='application/json';if(view)h['X-Fandian-Identity']=view;
  const response=await (body?POST:GET)(new Request(`https://champaign-fandian.haoyun963.chatgpt.site/api/game${query}`,{method:body?'POST':'GET',headers:h,...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json(),headers:response.headers,view:response.headers.get('X-Fandian-Identity')};
}
async function action(cookie,user,body){const current=await request(cookie,undefined,{user,query:'?profile=1'});return request(cookie,body,{user,view:current.view});}
async function savedGuest(cookie){
  await request(cookie,{action:'saveProfile',nickname:'保留的小李',expectedRevision:0});
  const catalog=(await request(cookie)).data;
  const body={action:'create',title:'保存的饭局',mode:'manual',requestId:randomUUID(),restaurantIds:catalog.restaurants.slice(0,2).map(r=>r.id)};
  const room=(await request(cookie,body)).data;return {room,body};
}
test('guest nickname survives the real issued cookie, reloads, and creating another meal',async()=>{
  const first=await request();const cookie=first.headers.get('Set-Cookie').match(/fd_session=([a-f0-9]{64})/)[1];
  assert.match(first.headers.get('Set-Cookie'),/HttpOnly/);assert.match(first.headers.get('Set-Cookie'),/Max-Age=31536000/);assert.match(first.headers.get('Set-Cookie'),/Secure/);
  await savedGuest(cookie);
  const again=await request(cookie,undefined,{query:'?profile=1'});assert.equal(again.data.nickname,'保留的小李');assert.equal(again.data.account.signed_in,false);assert.equal(again.view,first.view);
  const catalog=(await request(cookie)).data;
  assert.equal(catalog.activeRooms.length,1);assert.equal(catalog.profile.nickname,'保留的小李');
});
test('first sign-in adopts existing history and a second browser recovers the same identity',async()=>{
  const a=browser(),b=browser(),{room,body}=await savedGuest(a);
  const pool=await request(a,{action:'savePool',name:'常吃的两家',restaurantIds:body.restaurantIds,requestId:randomUUID()});assert.equal(pool.status,200);
  await request(a,{action:'vote',room:room.id,nickname:'保留的小李',candidateId:room.candidates[0].id});
  const logged=await request(a,undefined,{user:'alice'});
  assert.equal(logged.data.profile.nickname,'保留的小李');assert.equal(logged.data.profile.account.signed_in,true);
  const elsewhere=await request(b,undefined,{user:'alice'});
  assert.equal(elsewhere.data.profile.nickname,'保留的小李');assert.equal(elsewhere.view,logged.view);
  assert.equal(elsewhere.data.activeRooms[0].isHost,true);
  assert.deepEqual(elsewhere.data.pools,logged.data.pools);assert.equal(elsewhere.data.pools[0].name,'常吃的两家');
  const page=await request(b,undefined,{user:'alice',query:`?room=${room.id}`});
  assert.equal(page.data.myVote.nickname,'保留的小李');assert.equal(page.data.isHost,true);
  assert.equal(page.data.profile.sign_in_path,`/signin-with-chatgpt?return_to=${encodeURIComponent('/?room='+room.id)}`);
  assert.equal((await action(b,'alice',body)).data.id,room.id);
  const renamed=await action(b,'alice',{action:'saveProfile',nickname:'跨设备的新昵称',expectedRevision:page.data.profile.revision});assert.equal(renamed.status,200);
  assert.equal((await request(a,undefined,{user:'alice'})).data.profile.nickname,'跨设备的新昵称');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_links').get().n,1);
});
test('sign-out revokes anonymous access from the formerly adopted guest token',async()=>{
  const cookie=browser(),{room}=await savedGuest(cookie);
  const logged=await request(cookie,undefined,{user:'alice'});
  const signedOut=await request(cookie);
  assert.notEqual(signedOut.view,logged.view);assert.equal(signedOut.data.profile.nickname,'');assert.equal(signedOut.data.activeRooms.length,0);assert.match(signedOut.headers.get('Set-Cookie'),/fd_session=/);
  assert.equal((await request(cookie,{action:'deleteRoom',room:room.id})).status,404);
  const publicRoom=await request(cookie,undefined,{query:`?room=${room.id}`});assert.equal(publicRoom.data.isHost,false);assert.equal(publicRoom.data.profile.account.email,null);
  const back=await request(browser(),undefined,{user:'alice'});assert.equal(back.data.activeRooms[0].id,room.id);
});
test('different accounts cannot adopt an already linked browser identity',async()=>{
  const cookie=browser(),{room}=await savedGuest(cookie);
  const alice=await request(cookie,undefined,{user:'alice'});
  const bob=await request(cookie,undefined,{user:'bob'});
  assert.notEqual(alice.view,bob.view);assert.equal(bob.data.profile.nickname,'');assert.equal(bob.data.activeRooms.length,0);
  assert.equal((await action(cookie,'bob',{action:'deleteRoom',room:room.id})).status,404);
  assert.equal(db.sqlite.prepare('SELECT COUNT(DISTINCT owner) n FROM account_links').get().n,2);
  assert.equal((await request(cookie,undefined,{user:'alice'})).data.activeRooms[0].id,room.id);
});
test('stale account tabs and unauthenticated account writes cannot mutate the current account',async()=>{
  const cookie=browser(),a=await request(cookie,undefined,{user:'alice'}),b=await request(cookie,undefined,{user:'bob'});
  const payload={action:'saveProfile',nickname:'不应保存',expectedRevision:0};
  assert.equal((await request(cookie,payload,{user:'bob',view:a.view})).data.code,'AUTH_CHANGED');
  assert.equal((await request(cookie,payload,{user:'bob'})).data.code,'AUTH_CHANGED');
  assert.equal((await request(cookie,payload,{user:'bob',view:b.view})).status,200);
  const unsigned=await request(cookie,undefined,{headers:{'oai-authenticated-user-id':'alice'},query:'?profile=1'});assert.equal(unsigned.data.account.signed_in,false);
});
test('concurrent first logins use one account and preserve unrelated guest records',async()=>{
  const a=browser(),b=browser();await savedGuest(a);const {room:guestRoom}=await savedGuest(b);
  const results=await Promise.all([request(a,undefined,{user:'alice'}),request(b,undefined,{user:'alice'})]);
  assert.equal(results[0].view,results[1].view);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_links').get().n,1);
  const canonical=results[0].data.activeRooms[0].id;
  const other=canonical===guestRoom.id?a:b;
  const local=await request(other);assert.equal(local.data.activeRooms.length,1);assert.notEqual(local.data.activeRooms[0].id,canonical);
});
test('cross-site sign-in writes cannot create an account link and public members expose no email',async()=>{
  const cookie=browser();const denied=await request(cookie,{action:'saveProfile',nickname:'名字',expectedRevision:0},{user:'alice',headers:{Origin:'https://elsewhere.test'}});
  assert.equal(denied.status,403);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_links').get().n,0);
  const {room}=await savedGuest(cookie);await request(cookie,undefined,{user:'alice'});
  const publicRoom=(await request(browser(),undefined,{query:`?room=${room.id}`})).data;
  assert.ok(!JSON.stringify(publicRoom).includes('alice@example.test'));assert.ok(!JSON.stringify(publicRoom).includes('account_id'));
});

test('standalone hosts ignore spoofable Sites authentication headers',async()=>{
  const response=await GET(new Request('https://untrusted-host.test/api/game?profile=1',{headers:person('alice')}));
  const profile=await response.json();assert.equal(profile.account.signed_in,false);assert.equal(profile.sign_in_path,undefined);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM account_links').get().n,0);
});
