'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {gameFetch} from '@/lib/game-client';
import {formatMealDateTime} from '@/lib/meal-date';
import type {Notice} from '@/lib/types';
export function PersonalUpdates({items,open}: {items:Notice[];open:(id:string)=>void}) {
  const [through,setThrough]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const visible=items.filter(n=>n.id>through);
  if(!visible.length)return null;
  return <section className="personal-updates" aria-label="与我有关的新变化"><div><strong>与你有关的新变化 · {visible.length}</strong><Button variant="ghost" disabled={busy} onClick={async()=>{setBusy(true);setError('');const id=Math.max(...visible.map(n=>n.id));try{const response=await gameFetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'readUpdates',throughId:id})});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||'暂时无法保存已读。');setThrough(id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>全部标为已读</Button></div>
    <p role="status" className="fine-print">你有 {visible.length} 条未读变化，最新：{visible[0].message}</p>
    <details><summary>展开查看更新</summary><ul>{visible.map(n=><li key={n.id}><button onClick={()=>open(n.room_id)}><span>{n.message}</span><time dateTime={n.created_at}>{formatMealDateTime(n.created_at)}</time></button></li>)}</ul></details>{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
