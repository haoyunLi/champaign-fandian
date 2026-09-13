import {parseOrderDraft,type OrderDraft} from '@/lib/order-draft';
export type SavedOrderDraft=OrderDraft & {pending:boolean};
export type DraftState={draft:SavedOrderDraft|null;revision:number};
export class DraftError extends Error {constructor(message:string,public status=409,public code='DRAFT_CHANGED',public state?:DraftState){super(message);}}
export async function readDraft(db:D1Database,room:string,owner:string):Promise<DraftState> {
  const exists=await db.prepare('SELECT id FROM rooms WHERE id=? AND deleted_at IS NULL').bind(room).first();
  if(!exists)throw new DraftError('这轮饭局不存在或已被删除。',404,'DRAFT_UNAVAILABLE');
  const row=await db.prepare('SELECT payload,revision FROM order_drafts WHERE room_id=? AND owner=?').bind(room,owner).first<{payload:string|null;revision:number}>();
  const draft=row?.payload?JSON.parse(row.payload) as SavedOrderDraft:null;
  if(draft&&await db.prepare('SELECT id FROM orders WHERE id=? AND owner=? UNION ALL SELECT id FROM cancelled_order_requests WHERE id=? AND owner=? LIMIT 1').bind(draft.orderId,owner,draft.orderId,owner).first()) {
    await db.prepare('UPDATE order_drafts SET payload=NULL,revision=revision+1 WHERE room_id=? AND owner=? AND revision=?').bind(room,owner,row!.revision).run();
    return readDraft(db,room,owner);
  }
  return {draft,revision:row?.revision||0};
}
export async function writeDraft(db:D1Database,room:string,owner:string,body:Record<string,unknown>):Promise<DraftState> {
  const current=await readDraft(db,room,owner);
  if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new DraftError('请先读取草稿。',409,'DRAFT_CHANGED',current);
  let draft:SavedOrderDraft|null=null;
  if(body.action==='saveOrderDraft') {
    if(!await db.prepare("SELECT id FROM rooms WHERE id=? AND status='closed' AND winner_id IS NOT NULL").bind(room).first())throw new DraftError('确定餐馆后才能填写带饭草稿。',409,'DRAFT_UNAVAILABLE');
    const parsed=parseOrderDraft(JSON.stringify(body.draft));
    if(!parsed||typeof (body.draft as SavedOrderDraft)?.pending!=='boolean')throw new DraftError('草稿内容无效。',400,'DRAFT_INVALID');
    draft={...parsed,pending:(body.draft as SavedOrderDraft).pending};
    if(draft.pending&&(!draft.nickname.trim()||!draft.dish.trim()||!/^([1-9]|1[0-9]|20)$/.test(draft.quantity)))throw new DraftError('请核对昵称、菜名和 1–20 份的数量。',400,'DRAFT_INVALID');
    if(await db.prepare('SELECT id FROM orders WHERE id=? UNION ALL SELECT id FROM cancelled_order_requests WHERE id=? LIMIT 1').bind(draft.orderId,draft.orderId).first())throw new DraftError('这条登记已处理，请查看最新清单。',409,'DRAFT_CHANGED',current);
  }
  if(JSON.stringify(current.draft)===JSON.stringify(draft))return current; // A response may have been lost.
  if(current.revision!==body.expectedRevision)throw new DraftError('草稿已在其他页面修改，请先读取最新草稿。',409,'DRAFT_CHANGED',current);
  if(current.draft?.pending) {
    const active=await db.prepare("SELECT id FROM rooms WHERE id=? AND completed_at IS NULL AND orders_stopped_at IS NULL AND julianday(decided_at)>julianday('now','-12 hours')").bind(room).first();
    if(active)throw new DraftError('请先找回上次提交的登记，避免重复加单。',409,'DRAFT_PENDING',current);
  }
  const payload=draft?JSON.stringify(draft):null;
  const changed=current.revision===0
    ?await db.prepare(`INSERT INTO order_drafts(room_id,owner,payload,revision,updated_at)
      SELECT ?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE (SELECT COUNT(*) FROM order_drafts WHERE owner=? AND payload IS NOT NULL)<30
      ON CONFLICT(room_id,owner) DO NOTHING`).bind(room,owner,payload,owner).run()
    :await db.prepare("UPDATE order_drafts SET payload=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE room_id=? AND owner=? AND revision=?").bind(payload,room,owner,current.revision).run();
  if(changed.meta.changes)return {draft,revision:current.revision+1};
  throw new DraftError('草稿已变化，或未清空的草稿已满 30 份。请读取最新草稿后重试。',409,'DRAFT_CHANGED',await readDraft(db,room,owner));
}
