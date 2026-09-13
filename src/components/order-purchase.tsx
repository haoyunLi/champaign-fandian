'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {FoodOrder} from '@/lib/types';
type Action='markOrdered'|'markSoldOut'|'acceptChange'|'rejectChange';
const titles:Record<Action,string>={markOrdered:'确认已经向餐馆下单？',markSoldOut:'菜品售罄，需要换菜',acceptChange:'已与餐馆确认可以改单？',rejectChange:'这次改单无法接受？'};
export function OrderPurchase({order,busy,error,act}: {order:FoodOrder;busy:boolean;error:string;act:(body:Record<string,unknown>)=>Promise<boolean>}) {
  const [confirm,setConfirm]=useState<{action:Action;snapshot:FoodOrder}|null>(null),[issue,setIssue]=useState('');
  const changed=!!confirm&&confirm.snapshot.revision!==order.revision;
  function open(action:Action){setIssue(order.issue_note);setConfirm({action,snapshot:order});}
  return <div className="order-purchase">
    {order.issue_note&&<p className="order-issue">{order.issue_note}</p>}
    {order.change_request&&<div className="change-proposal"><strong>申请改为：{order.change_request.dish} × {order.change_request.quantity}</strong><p>{order.change_request.note||'无备注'}</p><p>等待带饭人确认，当前登记仍是 {order.dish} × {order.quantity}。</p></div>}
    {order.isCarrier&&order.status==='claimed'&&<div className="purchase-actions">
      {order.purchase_status!=='ordered'&&!order.change_request&&<Button variant="outline" disabled={busy} onClick={()=>open('markOrdered')}>{order.purchase_status==='sold_out'?'已恢复供应，确认下单':'确认已下单'}</Button>}
      <Button variant="ghost" disabled={busy} onClick={()=>open('markSoldOut')}>售罄 / 需要换菜</Button>
      {order.change_request&&<><Button variant="outline" disabled={busy} onClick={()=>open('acceptChange')}>同意改单</Button><Button variant="ghost" disabled={busy} onClick={()=>open('rejectChange')}>无法修改</Button></>}
    </div>}
    <Dialog open={!!confirm} onOpenChange={open=>!open&&!busy&&setConfirm(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{confirm&&titles[confirm.action]}</DialogTitle><DialogDescription>{confirm?.snapshot.nickname} · {confirm?.snapshot.dish} × {confirm?.snapshot.quantity} · {confirm?.snapshot.note||'无备注'}</DialogDescription></DialogHeader>
      {confirm?.action==='markOrdered'&&<p>请核对菜名、份数与忌口。标记后不能直接取消认领，后续改单需要你确认。</p>}
      {confirm?.action==='acceptChange'&&<p>申请改为 <strong>{confirm.snapshot.change_request?.dish} × {confirm.snapshot.change_request?.quantity}</strong>，备注：{confirm.snapshot.change_request?.note||'无'}。确认你已与餐馆协调好，保存后回到「尚未下单」，再核对新的下单情况。</p>}
      {confirm?.action==='rejectChange'&&<p>保留原菜品和下单状态，并通知收餐人联系你。</p>}
      {confirm?.action==='markSoldOut'&&<label className="field">给收餐人的说明<Input maxLength={120} value={issue} disabled={busy} onChange={e=>setIssue(e.target.value)} placeholder="例如：鸡肉卖完了，可以换牛肉"/></label>}
      {changed&&<p className="error" role="alert">这份登记已更新，请重新核对。<Button variant="ghost" onClick={()=>confirm&&open(confirm.action)}>查看最新内容</Button></p>}
      {error&&<p className="error" role="alert">{error}</p>}
      <Button className="primary full" disabled={busy||changed||!order.isCarrier||order.status!=='claimed'} onClick={async()=>{if(confirm&&await act({action:confirm.action,orderId:order.id,expectedRevision:confirm.snapshot.revision,issue,confirmRestaurant:confirm.action==='acceptChange'}))setConfirm(null);}}>确认保存</Button>
    </DialogContent></Dialog>
  </div>;
}
