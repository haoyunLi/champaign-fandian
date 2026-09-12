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
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try {
      const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'replay',room:roomId,requestId:requestId.current})});
      const value=await response.json() as Room & {error?:string};
      if(!response.ok)throw new Error(value.error||'暂时无法创建，请重试。');
      window.location.assign(`/?room=${encodeURIComponent(value.id)}`);
    } catch(e){setError((e as Error).message);running.current=false;setBusy(false);}
  }
  return <div className="replay-action"><Button variant="outline" className="secondary" disabled={busy} onClick={()=>void replay()}>{busy?<Loader2 className="spin"/>:<RotateCcw/>}{busy?'正在创建…':'再来一局'}</Button>{error&&<p className="error" role="alert">{error}</p>}</div>;
}
