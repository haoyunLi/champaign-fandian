'use client';
import { useRef,useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { gameFetch } from '@/lib/game-client';
import { mealShareText } from '@/lib/meal-share';
import type { Room } from '@/lib/types';
export function ShareMealStatus({room,update}: {room:Room;update:(room:Room)=>void}) {
  const [busy,setBusy]=useState(false),[text,setText]=useState<string|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);const input=useRef<HTMLTextAreaElement>(null);
  return <><Button variant="outline" className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');setCopied(false);try{const response=await gameFetch(`/api/game?room=${encodeURIComponent(room.id)}`);const latest=await response.json() as Room & {error?:string};if(!response.ok)throw new Error(latest.error||'暂时无法读取最新进度。');update(latest);const value=mealShareText(latest,`${window.location.origin}/?room=${room.id}`);setText(value);try{await navigator.clipboard.writeText(value);setCopied(true);}catch{}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><Copy/>{busy?'正在读取…':'复制群通知'}</Button>{error&&<p className="error" role="alert">{error}</p>}
  <Dialog open={text!==null} onOpenChange={open=>!open&&setText(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{copied?'已复制，粘贴到微信群即可':'饭局进度已整理好'}</DialogTitle><DialogDescription>包含当前餐馆、认领状态、取餐安排和饭局链接。发送前可以核对。</DialogDescription></DialogHeader><Textarea ref={input} readOnly rows={12} value={text||''} aria-label="饭局群通知"/><Button className="primary full" onClick={async()=>{try{await navigator.clipboard.writeText(text||'');setCopied(true);}catch{input.current?.focus();input.current?.select();setCopied(false);}}}>{copied?'再次复制':'复制通知'}</Button><Button variant="ghost" onClick={()=>{input.current?.focus();input.current?.select();}}>全选，手动复制</Button></DialogContent></Dialog></>
  ;
}
