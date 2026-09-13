'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, HandHeart, Loader2, LockKeyhole, Pencil, Plus, ShoppingBag, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { FoodOrder, Room } from '@/lib/types';
import { deadlineLabel, useMealPhase } from '@/components/meal-status';

type Filter='all'|'pending'|'carrying'|'mine';
type OrderAttempt={orderId:string;nickname:string;dish:string;quantity:number;note:string};
export function FoodOrders({ room, update }: { room: Room; update: (r: Room) => void }) {
  const [editor,setEditor]=useState<FoodOrder|'new'|null>(null);
  const [claim,setClaim]=useState<FoodOrder|null>(null), [cancel,setCancel]=useState<FoodOrder|null>(null), [delivery,setDelivery]=useState<FoodOrder|null>(null);
  const [stopConfirm,setStopConfirm]=useState(false);
  const [nickname,setNickname]=useState(room.myVote?.nickname || room.preferred_nickname || '');
  const [carrier,setCarrier]=useState(room.myVote?.nickname || room.preferred_nickname || '');
  const [dish,setDish]=useState(''),[quantity,setQuantity]=useState('1'),[note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>('all');
  const [copyText,setCopyText]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const orderId=useRef(''),busyRef=useRef(false),copyRef=useRef<HTMLTextAreaElement>(null);
  const orderAttempt=useRef<OrderAttempt|null>(null);
  const [pendingOrder,setPendingOrder]=useState(false);
  const pendingKey=`fd_pending_order_${room.id}`;
  const clearOrderAttempt=useCallback(()=>{
    orderAttempt.current=null;setPendingOrder(false);
    try{sessionStorage.removeItem(pendingKey);}catch{}
  },[pendingKey]);
  function restoreOrderDraft(value:OrderAttempt) {
    orderId.current=value.orderId;setNickname(value.nickname);setDish(value.dish);setQuantity(String(value.quantity));setNote(value.note);
  }
  useEffect(()=>{
    try{
      const value=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
      if(value&&typeof value.orderId==='string'&&/^[a-f0-9-]{36}$/.test(value.orderId)&&typeof value.nickname==='string'&&typeof value.dish==='string'&&typeof value.note==='string'&&Number.isInteger(value.quantity)&&value.quantity>=1&&value.quantity<=20){
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore an unresolved browser-stored submission after SSR.
        orderAttempt.current=value;setPendingOrder(true);restoreOrderDraft(value);setEditor('new');
      }
    }catch{}
  },[pendingKey]);
  const phase=useMealPhase(room),finished=phase==='finished';
  const stopped=!!room.orders_stopped_at;
  const winner=room.candidates.find(r=>r.id===room.winner_id);
  const delivered=room.orders.filter(o=>o.status==='delivered').length;
  const unfinished=room.orders.filter(o=>o.status!=='delivered');
  const carrying=room.orders.filter(o=>o.isCarrier);
  const counts={all:room.orders.length,pending:room.orders.filter(o=>o.status==='pending').length,carrying:carrying.length,mine:room.orders.filter(o=>o.isMine).length};
  const visible=room.orders.filter(o=>filter==='all'||(filter==='pending'&&o.status==='pending')||(filter==='carrying'&&o.isCarrier)||(filter==='mine'&&o.isMine));
  const currentEdit=editor && editor!=='new' ? room.orders.find(o=>o.id===editor.id) : undefined;
  const editChanged=!!editor && editor!=='new' && (!currentEdit || currentEdit.status!=='pending' || currentEdit.revision!==editor.revision);
  const currentClaim=claim ? room.orders.find(o=>o.id===claim.id) : undefined;
  const claimChanged=!!claim && (!currentClaim || currentClaim.status!=='pending' || currentClaim.revision!==claim.revision);
  const currentDelivery=delivery ? room.orders.find(o=>o.id===delivery.id) : undefined;
  const deliveryChanged=!!delivery && (!currentDelivery || currentDelivery.revision!==delivery.revision);
  const currentCancel=cancel ? room.orders.find(o=>o.id===cancel.id) : undefined;
  const cancelChanged=!!cancel && (!currentCancel || currentCancel.status!=='pending' || currentCancel.revision!==cancel.revision);
  const lastDelivery=!!delivery && unfinished.length===1 && unfinished[0].id===delivery.id;
  useEffect(()=>{if(editor==='new'&&room.orders.some(o=>o.id===orderId.current&&o.isMine)){clearOrderAttempt();setEditor(null);setFilter('mine');}},[editor,room.orders,clearOrderAttempt]);
  function openEditor(value:FoodOrder|'new') {
    if(value==='new'&&(stopped||finished))return;
    setError(''); setEditor(value);
    if(value==='new'){if(orderAttempt.current){restoreOrderDraft(orderAttempt.current);return;}if(!nickname)setNickname(room.preferred_nickname||room.myVote?.nickname||'');orderId.current=crypto.randomUUID();setDish('');setQuantity('1');setNote('');}
    else {setDish(value.dish);setQuantity(String(value.quantity));setNote(value.note);}
  }
  async function act(payload:Record<string,unknown>) {
    if(busyRef.current || finished) return false;
    busyRef.current=true;setBusy(true);setError('');
    try {
      const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:room.id,...payload})});
      const value=await response.json() as Room & {error?:string;code?:string;room?:Room};
      if(!response.ok){
        if(payload.action==='order'&&response.status<500)clearOrderAttempt();
        if(value.room) update(value.room);
        if(value.code==='FINAL_DELIVERY_CONFIRM_REQUIRED') {
          setDelivery(value.room?.orders.find(o=>o.id===payload.orderId)||null);
          return false;
        }
        throw new Error(value.error||'暂时无法保存，请重试。');
      }
      update(value);return true;
    } catch(e){setError((e as Error).message);return false;}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function copyOrders() {
    const text=[`${room.title} · 我来带`, `餐馆：${winner?.name || '已确定'}`, ...carrying.map((o,i)=>`${i+1}. ${o.nickname}：${o.dish} × ${o.quantity}\n   备注：${o.note || '无'}\n   状态：${o.status==='delivered'?'已带回':'已认领，待带回'}`), `共 ${carrying.length} 条 / ${carrying.reduce((n,o)=>n+o.quantity,0)} 份`].join('\n');
    try{await navigator.clipboard.writeText(text);setCopied(true);}
    catch{setCopyText(text);setCopied(false);}
  }
  const emptyText:Record<Filter,string>={all:finished?'本轮没有带饭登记':'还没有带饭登记',pending:finished?'没有未认领的登记':'目前没有待认领的带饭',carrying:'你还没有认领带饭',mine:'你还没有登记带饭'};
  return <section className="food-orders" id="food-orders">
    <div className="section-heading"><div><h2><ShoppingBag/>带饭清单</h2><p>{room.orders.length} 条登记 · {room.orders.reduce((n,o)=>n+o.quantity,0)} 份 · {delivered} 条已带回</p></div>{!finished&&!stopped&&<Button className="primary order-cta" disabled={busy} onClick={()=>openEditor('new')}><Plus/>帮我带一份</Button>}</div>
    <div className={`meal-progress ${finished?'meal-finished':''}`} role="status"><strong>{finished ? room.completion_reason==='delivered'?'全部带饭已带回，本轮结束':'确定餐馆已满 12 小时，本轮自动结束' : `带饭进行中 · ${counts.pending} 条待认领`}</strong><p>{finished?'结果和清单已保留，未完成的登记保持原状态。':`全部带回后结束；否则将在 ${deadlineLabel(room.delivery_deadline_at)} 自动结束（确定餐馆起 12 小时）。`}</p></div>
    {!finished&&<div className={`order-intake ${stopped?'intake-stopped':''}`} role="status"><div><strong>{stopped?'已停止加单':'还可以登记带饭'}</strong><p>{stopped?`停止于 ${deadlineLabel(room.orders_stopped_at)}。已有登记仍可修改、认领和带回。`:'开始下单后，发起人或已认领带饭的人可以停止接收新登记。'}</p></div>{!stopped&&room.canStopOrders&&<Button className="secondary" variant="outline" disabled={busy} onClick={()=>{setError('');setStopConfirm(true);}}><LockKeyhole size={16}/>停止加单</Button>}</div>}
    <div className="order-toolbar"><div className="order-filters" role="group" aria-label="带饭清单筛选">{([['all','全部'],['pending','待认领'],['carrying','我来带'],['mine','我的登记']] as [Filter,string][]).map(([value,label])=><Button key={value} variant="ghost" aria-pressed={filter===value} onClick={()=>{setFilter(value);setCopied(false);}}>{label}<span>{counts[value]}</span></Button>)}</div><Button className="copy-orders" variant="outline" disabled={!carrying.length} onClick={()=>void copyOrders()}><Copy/>{copied?'已复制我的清单':'复制我来带的清单'}</Button></div>
    {!visible.length ? <div className="orders-empty"><HandHeart/><div><strong>{emptyText[filter]}</strong><p>{filter==='carrying'?'在「待认领」里选择你可以帮忙带的菜。':filter==='mine'&&!finished?(stopped?'本轮已停止接收新登记。':'点击「帮我带一份」填写菜名和备注。'):filter==='pending'&&room.orders.length?'可以切换到「全部」查看认领和带回情况。':finished?'投票结果仍可查看。':stopped?'本轮已停止接收新登记。':'去不了的朋友可以登记，去的朋友可以认领。'}</p></div></div> : <div className="orders-list">{visible.map(o=><article className={`order-row order-${o.status}`} key={o.id}>
      <div className="order-main"><div className="order-title"><strong>{o.dish}</strong><span>× {o.quantity}</span></div><p><b>{o.nickname}</b> 想吃{o.isMine&&<span className="mine-label">我的登记</span>}</p>{o.note&&<p className="order-note">{o.note}</p>}</div>
      <div className="order-actions"><span className={`order-status ${o.status}`}>{o.status==='pending'?(finished?'未认领（本轮已结束）':'等人带饭'):o.status==='claimed'?`${o.claimant_name} 来带${finished?'（尚未标记带回）':''}`:`${o.claimant_name} 已带回`}</span>
        {!finished&&<div className="order-buttons">{o.status==='pending'&&<Button className="secondary" variant="outline" disabled={busy} onClick={()=>{setError('');if(!carrier)setCarrier(room.preferred_nickname||room.myVote?.nickname||'');setClaim(o);}}><HandHeart/>我来带</Button>}{o.status==='pending'&&o.isMine&&<><Button variant="ghost" disabled={busy} aria-label={`编辑 ${o.dish}`} onClick={()=>openEditor(o)}><Pencil/>编辑</Button><Button size="icon" variant="ghost" aria-label={`取消 ${o.dish}`} disabled={busy} onClick={()=>{setError('');setCancel(o);}}><X/></Button></>}{o.status==='claimed'&&o.canManage&&<><Button className="secondary" variant="outline" disabled={busy} onClick={()=>{setError('');if(unfinished.length===1)setDelivery(o);else void act({action:'deliver',orderId:o.id,expectedRevision:o.revision});}}><Check/>已带回</Button><Button size="icon" variant="ghost" aria-label={`取消认领 ${o.dish}`} disabled={busy} onClick={()=>void act({action:'release',orderId:o.id,expectedRevision:o.revision})}><Undo2/></Button></>}</div>}
      </div>
    </article>)}</div>}
    {error&&!editor&&!claim&&!cancel&&!delivery&&<p className="error" role="alert">{error}</p>}
    <Dialog open={!!editor} onOpenChange={open=>!open&&!busy&&setEditor(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{editor==='new'?'我不去，帮我带饭':'修改我的带饭'}</DialogTitle><DialogDescription>{winner?.name} · {editor==='new'?'填写具体菜名，方便朋友下单。':'保存后保留这条登记，无需取消重填。'}</DialogDescription></DialogHeader>
      <form onSubmit={async e=>{
        e.preventDefault();if(busyRef.current||finished||editChanged||(editor==='new'&&stopped))return;
        let payload:Record<string,unknown>;
        if(editor==='new'){
          const attempt=orderAttempt.current||{orderId:orderId.current,nickname:room.preferred_nickname||nickname,dish,quantity:Number(quantity),note};
          orderAttempt.current=attempt;setPendingOrder(true);
          try{sessionStorage.setItem(pendingKey,JSON.stringify(attempt));}catch{}
          payload={action:'order',...attempt};
        }else payload={action:'editOrder',orderId:editor?.id,expectedRevision:editor?.revision,dish,quantity:Number(quantity),note};
        if(await act(payload)){if(editor==='new')clearOrderAttempt();setEditor(null);setFilter('mine');}
      }}>
        {editor==='new'&&<label className="field">你的群昵称（顶部可修改）<Input disabled={busy} readOnly={pendingOrder||!!room.preferred_nickname} required maxLength={24} value={pendingOrder?nickname:room.preferred_nickname||nickname} onChange={e=>setNickname(e.target.value)}/></label>}
        <label className="field">想吃什么<Input disabled={busy} readOnly={editor==='new'&&pendingOrder} required maxLength={100} value={dish} onChange={e=>setDish(e.target.value)} placeholder="例如：宫保鸡丁盒饭"/></label>
        <label className="field">份数<Input disabled={busy} readOnly={editor==='new'&&pendingOrder} type="number" required min={1} max={20} step={1} inputMode="numeric" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <label className="field">备注 <span>选填</span><Textarea disabled={busy} readOnly={editor==='new'&&pendingOrder} maxLength={240} value={note} onChange={e=>setNote(e.target.value)} placeholder="口味、忌口、取餐地点"/></label>
        {editor==='new'&&pendingOrder&&!busy&&!finished&&!stopped&&<p className="fine-print" role="status">正在确认上次登记结果。重试会找回同一条登记；确认保存后，可在「我的登记」中编辑。</p>}
        {finished?<p className="error" role="alert">本轮已结束，不能保存。填写内容已保留，仍可复制。</p>:editChanged&&<p className="error" role="alert">登记已被修改、认领或取消，暂未覆盖你的填写内容。{currentEdit?.status==='pending'&&<Button type="button" variant="ghost" onClick={()=>openEditor(currentEdit)}>读取最新内容</Button>}</p>}
        {!finished&&editor==='new'&&stopped&&<p className="error" role="alert">本轮已停止加单，不能提交新登记。填写内容已保留，可复制后与带饭人联系。</p>}
        {error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||finished||editChanged||(editor==='new'&&stopped)}>{busy?<Loader2 className="spin"/>:<Check/>}{busy?'正在保存…':editor==='new'?pendingOrder?'重试，找回上次登记':'加入带饭清单':'保存修改'}</Button>
        <p className="fine-print">未认领前可以修改。菜品是否有售、价格和付款请在群里确认。</p>
      </form>
    </DialogContent></Dialog>
    <Dialog open={!!claim&&!finished} onOpenChange={open=>!open&&!busy&&setClaim(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>这份我来带</DialogTitle><DialogDescription>帮 {claim?.nickname} 带 {claim?.dish} × {claim?.quantity}。{claim?.note&&`备注：${claim.note}`}</DialogDescription></DialogHeader>
      {claimChanged?<div><p className="error" role="alert">这份登记已更新，请先查看最新菜名和备注。</p>{currentClaim?.status==='pending'&&<Button variant="outline" className="secondary full" onClick={()=>{setClaim(currentClaim);setError('');}}>查看最新登记</Button>}</div>:null}
      <form onSubmit={async e=>{e.preventDefault();if(!claim||claimChanged)return;if(await act({action:'claim',orderId:claim.id,expectedRevision:claim.revision,nickname:room.preferred_nickname||carrier})){setClaim(null);setFilter('carrying');}}}><label className="field">带饭人的群昵称（顶部可修改）<Input required maxLength={24} value={room.preferred_nickname||carrier} readOnly={!!room.preferred_nickname} onChange={e=>setCarrier(e.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||finished||claimChanged}>确认，我来带</Button></form>
    </DialogContent></Dialog>
    <Dialog open={!!cancel&&!finished} onOpenChange={open=>!open&&!busy&&setCancel(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>取消这条带饭登记？</DialogTitle><DialogDescription>{cancel?.dish} × {cancel?.quantity} 将移除。如果只是改菜，请使用「编辑」。若其余登记均已带回，取消后本轮也会结束。</DialogDescription></DialogHeader>{cancelChanged&&<div><p className="error" role="alert">这份登记已更新，请先查看最新内容，再决定是否取消。</p>{currentCancel?.status==='pending'&&currentCancel.isMine&&<Button variant="outline" className="secondary full" onClick={()=>{setCancel(currentCancel);setError('');}}>查看最新登记</Button>}</div>}{error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||finished||cancelChanged} onClick={async()=>{if(await act({action:'cancelOrder',orderId:cancel?.id,expectedRevision:cancel?.revision}))setCancel(null);}}>确认取消</Button></DialogContent></Dialog>
    <Dialog open={!!delivery&&!finished} onOpenChange={open=>!open&&!busy&&setDelivery(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{deliveryChanged?'带饭登记已更新':lastDelivery?'最后一份也带回了吗？':'确认这份已带回？'}</DialogTitle><DialogDescription>{delivery?.nickname} 的 {delivery?.dish} × {delivery?.quantity}。{lastDelivery?'确认后本轮结束，不能再加单。':'有其他尚未完成的登记，本次只标记这份已带回。'}</DialogDescription></DialogHeader>{deliveryChanged&&<div><p className="error" role="alert">昵称、菜品或认领状态已变化，请先查看最新内容，再确认带回。</p>{currentDelivery?.status==='claimed'&&currentDelivery.canManage&&<Button variant="outline" className="secondary full" onClick={()=>{setDelivery(currentDelivery);setError('');}}>查看最新登记</Button>}</div>}{error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||finished||deliveryChanged||currentDelivery?.status!=='claimed'||!currentDelivery?.canManage} onClick={async()=>{if(await act({action:'deliver',orderId:delivery?.id,expectedRevision:delivery?.revision,confirmFinish:lastDelivery}))setDelivery(null);}}>{busy?'正在保存…':lastDelivery?'确认带回并结束饭局':'确认已带回'}</Button></DialogContent></Dialog>
    <Dialog open={stopConfirm&&!finished&&!stopped} onOpenChange={open=>!busy&&setStopConfirm(open)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>开始下单，停止加单？</DialogTitle><DialogDescription>停止后不再接收新登记，本轮不能重新开放加单。已有 {room.orders.length} 条登记，其中 {counts.pending} 条待认领，仍可继续修改、认领和带回。饭局不会立即结束，原来的 12 小时截止时间保持不变。</DialogDescription></DialogHeader>{!room.canStopOrders&&<p className="error" role="alert">你的认领状态已变化，当前不能停止加单。</p>}{error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||finished||stopped||!room.canStopOrders} onClick={async()=>{if(await act({action:'stopOrders'}))setStopConfirm(false);}}>{busy?'正在停止…':'确认停止加单'}</Button></DialogContent></Dialog>
    <Dialog open={copyText!==null} onOpenChange={open=>!open&&setCopyText(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>复制我的带饭清单</DialogTitle><DialogDescription>浏览器未能自动复制，请长按或全选下方内容复制。</DialogDescription></DialogHeader><Textarea ref={copyRef} readOnly value={copyText||''} rows={12} aria-label="我的带饭清单"/><Button variant="outline" className="secondary full" onClick={()=>{copyRef.current?.focus();copyRef.current?.select();}}>全选清单</Button></DialogContent></Dialog>
    {!finished&&<div className="mobile-action-bar" data-hidden={!!editor||!!claim||!!cancel||!!delivery||(stopConfirm&&!stopped)||copyText!==null}><span>{carrying.length?`我来带 ${carrying.length} 条`:`${counts.pending} 条待认领`}</span>{stopped?<Button className="primary" disabled={busy} onClick={()=>{setFilter(carrying.length?'carrying':'all');document.getElementById('food-orders')?.scrollIntoView({behavior:'smooth'});}}>查看带饭清单</Button>:<Button className="primary" disabled={busy} onClick={()=>openEditor('new')}><Plus/>帮我带一份</Button>}</div>}
  </section>;
}
