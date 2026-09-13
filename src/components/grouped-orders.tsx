'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {groupOrders} from '@/lib/order-summary';
import {gameFetch} from '@/lib/game-client';
import type {FoodOrder,Room} from '@/lib/types';
export function GroupedOrders({orders,restaurant,roomId,update}: {orders:FoodOrder[];restaurant:string;roomId:string;update:(room:Room)=>void}) {
  const [copied,setCopied]=useState(false),[fallback,setFallback]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const carrying=orders.filter(o=>o.isCarrier&&o.status==='claimed');
  const ready=carrying.filter(o=>o.purchase_status==='unplaced'&&!o.change_request),groups=groupOrders(ready);
  if(!carrying.length)return null;
  return <details className="grouped-orders"><summary>按菜品汇总 · 待下单 {ready.reduce((n,o)=>n+o.quantity,0)} 份</summary><p>只汇总你认领、尚未下单且没有待确认改单的登记。菜名与备注完全相同才合并。</p>
    {!groups.length?<p>当前没有可直接下单的登记。</p>:<ul>{groups.map((g,i)=><li key={i}><strong>{g.dish} × {g.quantity}</strong><p>备注：{g.note||'无'}</p><p>{g.recipients.map(r=>`${r.name} × ${r.quantity}`).join('、')}</p></li>)}</ul>}
    <Button variant="outline" disabled={busy||!groups.length} onClick={async()=>{
      setBusy(true);setError('');setCopied(false);setFallback('');
      try{
        const response=await gameFetch(`/api/game?room=${encodeURIComponent(roomId)}`),latest=await response.json() as Room&{error?:string};
        if(!response.ok)throw new Error(latest.error||'暂时无法核对最新清单。');update(latest);
        if(latest.phase!=='delivery')throw new Error('本轮已经结束，请查看历史清单。');
        const current=latest.orders.filter(o=>o.isCarrier&&o.status==='claimed'&&o.purchase_status==='unplaced'&&!o.change_request);
        if(!current.length)throw new Error('最新清单中没有待下单的登记。');
        const text=[`${restaurant} · 我的待下单汇总`,...groupOrders(current).map((g,i)=>`${i+1}. ${g.dish} × ${g.quantity}\n   备注：${g.note||'无'}\n   收餐人：${g.recipients.map(r=>`${r.name} × ${r.quantity}`).join('、')}`),`总计 ${current.reduce((n,o)=>n+o.quantity,0)} 份。已下单、售罄及等待改单确认的登记不计入。`].join('\n');
        try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setFallback(text);}
      }catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }}>{busy?'正在核对最新清单…':copied?'已复制，可再次复制最新清单':'复制待下单汇总'}</Button>{error&&<p className="error" role="alert">{error}</p>}
    {fallback&&<label className="field">长按或全选复制<Textarea readOnly value={fallback} rows={8} onFocus={e=>e.target.select()}/></label>}
  </details>;
}
