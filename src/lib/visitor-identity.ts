import type { AccountSession } from './types';

const SESSION_AGE=31536000;
export async function identityHash(value:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
function freshToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
function sessionCookie(token:string,request:Request) {
  return `fd_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_AGE}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export async function visitorIdentity(request:Request,db:D1Database) {
  const existing=request.headers.get('cookie')?.match(/(?:^|;\s*)fd_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  let token=existing||freshToken(),owner=await identityHash(token);
  // These headers are set and sanitized by the Sites authentication dispatcher.
  // A standalone deployment must supply an equally trusted identity gateway.
  const hostname=new URL(request.url).hostname;
  const authAvailable=hostname==='champaign-fandian.haoyun963.chatgpt.site'||hostname==='localhost'||hostname==='127.0.0.1';
  const userId=authAvailable?request.headers.get('oai-authenticated-user-id'):null;
  const email=request.headers.get('oai-authenticated-user-email');
  const signedIn=!!userId&&!!email;
  if(signedIn) {
    const accountId=await identityHash(`chatgpt:${userId}`);
    let linked=await db.prepare('SELECT owner FROM account_links WHERE account_id=?').bind(accountId).first<{owner:string}>();
    if(!linked) {
      // Adopt this browser's existing records only on the account's first login.
      // A visitor identity can belong to only one account, including racing logins.
      await db.prepare(`INSERT OR IGNORE INTO account_links (account_id,owner,created_at)
        SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM account_links WHERE owner=?)`)
        .bind(accountId,owner,new Date().toISOString(),owner).run();
      await db.prepare('INSERT OR IGNORE INTO account_links (account_id,owner,created_at) VALUES (?,?,?)')
        .bind(accountId,await identityHash(`account-owner:${accountId}`),new Date().toISOString()).run();
      linked=await db.prepare('SELECT owner FROM account_links WHERE account_id=?').bind(accountId).first<{owner:string}>();
    }
    if(!linked)throw new Error('Account identity could not be established');
    owner=linked.owner;
  } else if(await db.prepare('SELECT account_id FROM account_links WHERE owner=?').bind(owner).first()) {
    // After sign-out, the old guest token must no longer open account-owned data.
    token=freshToken();owner=await identityHash(token);
  }
  // This label detects stale tabs; it is neither the identity key nor a credential.
  const viewKey=await identityHash(`view:${owner}`);
  const account:AccountSession={signed_in:signedIn,email:signedIn?email:null};
  return {owner,account,authAvailable,viewKey,cookie:token!==existing?sessionCookie(token,request):null};
}
