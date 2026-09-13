'use client';
import {useState} from 'react';
import {Check,HandHeart,ShoppingBag} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {FoodOrder} from '@/lib/types';
type Action='markOrdered'|'markSoldOut'|'acceptChange'|'rejectChange';
const titles:Record<Action,string>={markOrdered:'确认已经向餐馆下单？',markSoldOut:'菜品售罄，需要换菜',acceptChange:'已与餐馆确认可以改单？',rejectChange:'这次改单无法接受？'};
export function OrderPurchase({order,finished,busy,error,act,claim,edit,cancel,deliver,release}: {order:FoodOrder;finished:boolean;busy:boolean;error:string;claim:()=>void;edit:()=>void;cancel:()=>void;deliver:()=>void;release:()=>void;act:(body:Record<string,unknown>)=>Promise<boolean>}) {
  const [confirm,setConfirm]=useState<{action:Action;snapshot:FoodOrder}|null>(null),[issue,setIssue]=useState('');
  const changed=!!confirm&&confirm.snapshot.revision!==order.revision;
  function open(action:Action){setIssue(order.issue_note);setConfirm({action,snapshot:order});}
  const canDeliver=order.status==='claimed'&&order.canManage&&order.purchase_status!=='sold_out'&&!order.change_request;
  const primaryDelivery=canDeliver&&order.purchase_status==='ordered';
  const primaryEdit=order.status==='claimed'&&order.isMine&&!order.isCarrier&&order.purchase_status==='sold_out';
  const hasMore=(order.status==='pending'&&order.isMine)||(order.status==='claimed'&&(order.isMine||order.isCarrier||order.canManage));
  return <div className="order-purchase">
    {order.issue_note&&<p className="order-issue">{order.issue_note}</p>}
    {order.change_request&&<div className="change-proposal"><strong>申请改为：{order.change_request.dish} × {order.change_request.quantity}</strong><p>{order.change_request.note||'无备注'}</p><p>等待带饭人确认，当前登记仍是 {order.dish} × {order.quantity}。</p></div>}
    {!finished&&<div className="order-controls">
      {order.status==='pending'&&<Button className="primary" disabled={busy} onClick={claim}><HandHeart/>我来带</Button>}
      {order.status==='claimed'&&order.isCarrier&&order.change_request&&<Button className="primary" disabled={busy} onClick={()=>open('acceptChange')}>核对并同意改单</Button>}
      {order.status==='claimed'&&order.isCarrier&&!order.change_request&&order.purchase_status!=='ordered'&&<Button className="primary" disabled={busy} onClick={()=>open('markOrdered')}><ShoppingBag/>{order.purchase_status==='sold_out'?'恢复供应，确认下单':'标记已下单'}</Button>}
      {primaryDelivery&&<Button className="primary" disabled={busy} onClick={deliver}><Check/>已带回</Button>}
      {primaryEdit&&<Button className="primary" disabled={busy} onClick={edit}>{order.change_request?'修改换菜申请':'申请换菜'}</Button>}
      {hasMore&&<details className="order-more" onClick={e=>{if((e.target as HTMLElement).closest('button'))e.currentTarget.open=false;}}><summary>更多<span className="sr-only">：{order.nickname}的{order.dish}</span></summary><div>
        {order.status==='pending'&&order.isMine&&<><Button variant="ghost" disabled={busy} onClick={edit}>修改登记</Button><Button variant="ghost" disabled={busy} onClick={cancel}>取消登记</Button></>}
        {order.status==='claimed'&&order.isMine&&!primaryEdit&&<Button variant="ghost" disabled={busy} onClick={edit}>{order.change_request?'修改改单申请':'申请换菜 / 改单'}</Button>}
        {order.status==='claimed'&&order.isCarrier&&<><Button variant="ghost" disabled={busy} onClick={()=>open('markSoldOut')}>售罄 / 需要换菜</Button>{order.change_request&&<Button variant="ghost" disabled={busy} onClick={()=>open('rejectChange')}>无法接受改单</Button>}</>}
        {canDeliver&&!primaryDelivery&&<Button variant="ghost" disabled={busy} onClick={deliver}>已经带回，直接确认</Button>}
        {order.status==='claimed'&&order.canManage&&<Button variant="ghost" disabled={busy||order.purchase_status==='ordered'||!!order.change_request} onClick={release}>取消认领</Button>}
      </div></details>}
    </div>}
    <Dialog open={!!confirm} onOpenChange={open=>!open&&!busy&&setConfirm(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{confirm&&titles[confirm.action]}</DialogTitle><DialogDescription>{confirm?.snapshot.nickname} · {confirm?.snapshot.dish} × {confirm?.snapshot.quantity} · {confirm?.snapshot.note||'无备注'}</DialogDescription></DialogHeader>
      {confirm?.action==='markOrdered'&&<p>请核对菜名、份数与忌口。标记后不能直接取消认领，后续改单需要你确认。</p>}
      {confirm?.action==='acceptChange'&&<p>申请改为 <strong>{confirm.snapshot.change_request?.dish} × {confirm.snapshot.change_request?.quantity}</strong>，备注：{confirm.snapshot.change_request?.note||'无'}。确认你已与餐馆协调好，保存后回到「尚未下单」，再核对新的下单情况。</p>}
      {confirm?.action==='rejectChange'&&<p>保留原菜品和下单状态，并通知收餐人联系你。</p>}
      {confirm?.action==='markSoldOut'&&<label className="field">给收餐人的说明<Input maxLength={120} value={issue} disabled={busy} onChange={e=>setIssue(e.target.value)} placeholder="例如：鸡肉卖完了，可以换牛肉"/></label>}
      {changed&&<p className="error" role="alert">这份登记已更新，请重新核对。<Button variant="ghost" onClick={()=>confirm&&open(confirm.action)}>查看最新内容</Button></p>}
      {error&&<p className="error" role="alert">{error}</p>}
      <Button className="primary full" disabled={busy||finished||changed||!order.isCarrier||order.status!=='claimed'} onClick={async()=>{if(confirm&&await act({action:confirm.action,orderId:order.id,expectedRevision:confirm.snapshot.revision,issue,confirmRestaurant:confirm.action==='acceptChange'}))setConfirm(null);}}>确认保存</Button>
    </DialogContent></Dialog>
  </div>;
}
