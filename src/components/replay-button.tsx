'use client';
import { useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Room } from '@/lib/types';
export function ReplayButton({roomId}:{roomId:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestId=useRef(''),running=useRef(false);
  async function replay() {
    if(running.current)return;
    running.current=true;setBusy(true);setError('');
    const pendingKey=`fd_pending_replay_${roomId}`;
    if(!requestId.current){
      try{const saved=sessionStorage.getItem(pendingKey);if(saved&&/^[a-f0-9-]{36}$/.test(saved))requestId.current=saved;}catch{}
      if(!requestId.current)requestId.current=crypto.randomUUID();
      try{sessionStorage.setItem(pendingKey,requestId.current);}catch{}
    }
    try {
      const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'replay',room:roomId,requestId:requestId.current})});
      const value=await response.json() as Room & {error?:string};
      if(!response.ok){
        if(response.status<500){requestId.current='';try{sessionStorage.removeItem(pendingKey);}catch{}}
        throw new Error(value.error||'暂时无法创建，请重试。');
      }
      try{sessionStorage.removeItem(pendingKey);}catch{}
      window.location.assign(`/?room=${encodeURIComponent(value.id)}`);
    } catch(e){setError((e as Error).message);running.current=false;setBusy(false);}
  }
  return <div className="replay-action"><Button variant="outline" className="secondary" disabled={busy} onClick={()=>void replay()}>{busy?<Loader2 className="spin"/>:<RotateCcw/>}{busy?'正在创建…':'再来一局'}</Button>{error&&<p className="error" role="alert">{error}</p>}</div>;
}
