'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {gameFetch,gameIdentityKey} from '@/lib/game-client';
import {parseOrderDraft} from '@/lib/order-draft';
import type {DraftState,SavedOrderDraft} from '@/lib/order-draft-store';

// Server storage restores drafts across visits; this identity-scoped journal covers
// the last keystrokes when a mobile browser closes before autosave can finish.
export function useOrderDraft(roomId:string) {
  const [draft,setDraft]=useState<SavedOrderDraft|null>(null),[ready,setReady]=useState(false),[message,setMessage]=useState('');
  const [conflict,setConflict]=useState(false),[saving,setSaving]=useState(false);
  const state=useRef<DraftState>({draft:null,revision:0}),desired=useRef<SavedOrderDraft|null>(null),key=useRef('');
  const blocked=useRef(false),chain=useRef<Promise<boolean>>(Promise.resolve(true)),mounted=useRef(true);
  const journal=useCallback((value:SavedOrderDraft|null)=>{
    try{if(key.current)localStorage.setItem(key.current,JSON.stringify({draft:value,revision:state.current.revision,conflict:blocked.current}));}catch{setMessage('此浏览器无法保留离线草稿，请等待保存成功后关闭。');}
  },[]);
  const flush=useCallback(()=>{
    const operation=chain.current.then(async()=>{
      if(blocked.current)return false;
      const value=desired.current;
      if(JSON.stringify(value)===JSON.stringify(state.current.draft))return true;
      if(mounted.current)setSaving(true);
      try{
        const response=await gameFetch('/api/game',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({action:value?'saveOrderDraft':'clearOrderDraft',room:roomId,expectedRevision:state.current.revision,draft:value})});
        const body=await response.json() as DraftState & {error?:string;code?:string;draftState?:DraftState};
        if(!response.ok){if(body.code==='DRAFT_CHANGED'||body.code==='DRAFT_PENDING'){blocked.current=true;if(mounted.current)setConflict(true);}throw new Error(body.error||'草稿暂未保存。');}
        state.current=body;
        if(JSON.stringify(desired.current)===JSON.stringify(value)){try{localStorage.removeItem(key.current);}catch{}if(mounted.current)setMessage(value?'草稿已保存，关闭页面后可继续填写。':'');}
        else journal(desired.current);
        return true;
      }catch(error){if(mounted.current)setMessage((error as Error).message);return false;}
      finally{if(mounted.current)setSaving(false);}
    });
    chain.current=operation;return operation;
  },[roomId,journal]);
  const change=useCallback((value:SavedOrderDraft|null)=>{desired.current=value;setDraft(value);journal(value);},[journal]);
  const load=useCallback(async(preferServer=false)=>{
    try{
      const response=await gameFetch(`/api/game?room=${encodeURIComponent(roomId)}&draft=1`);
      const body=await response.json() as DraftState & {error?:string};
      if(!response.ok)throw new Error(body.error||'暂时无法读取草稿。');
      key.current=`fd_order_journal_${gameIdentityKey()}_${roomId}`;state.current=body;
      let recovered=body.draft,local:(DraftState & {conflict?:boolean})|null=null;
      try{const parsed=JSON.parse(localStorage.getItem(key.current)||'null');if(parsed&&Number.isSafeInteger(parsed.revision)&&(parsed.draft===null||(parseOrderDraft(JSON.stringify(parsed.draft))&&typeof parsed.draft.pending==='boolean')))local=parsed;}catch{}
      if(!preferServer&&local){
        if(local.conflict){blocked.current=true;setConflict(true);recovered=local.draft;setMessage('本机填写与其他页面有冲突，请先核对并读取最新草稿。');}
        else if(local.revision===body.revision)recovered=local.draft;
        else if(JSON.stringify(local.draft)!==JSON.stringify(body.draft)){blocked.current=true;setConflict(true);recovered=local.draft;setMessage('还有本机未保存的填写，但其他页面已更新草稿。请核对后读取最新草稿。');}
      }
      if(preferServer){blocked.current=false;setConflict(false);try{localStorage.removeItem(key.current);}catch{}}
      // One-time migration of drafts made by the previous version in this tab.
      if(!preferServer&&!local&&!recovered){try{
        const oldAttempt=JSON.parse(sessionStorage.getItem(`fd_pending_order_${roomId}`)||'null');
        const old=oldAttempt?parseOrderDraft(JSON.stringify({...oldAttempt,quantity:String(oldAttempt.quantity)})):parseOrderDraft(sessionStorage.getItem(`fd_pending_draft_${roomId}`));
        if(old){recovered={...old,pending:!!oldAttempt};sessionStorage.removeItem(`fd_pending_order_${roomId}`);sessionStorage.removeItem(`fd_pending_draft_${roomId}`);}
      }catch{}}
      desired.current=recovered;setDraft(recovered);setReady(true);
      if(!blocked.current){setMessage(recovered?'找到上次未完成的登记。':'');if(JSON.stringify(recovered)!==JSON.stringify(body.draft)){journal(recovered);void flush();}}
    }catch(error){setMessage((error as Error).message);}
  },[roomId,journal,flush]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Bootstrap private server storage after hydration.
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
  useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void flush(),600);return()=>clearTimeout(timer);},[draft,ready,flush]);
  useEffect(()=>{const hidden=()=>{if(document.visibilityState==='hidden')void flush();};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[flush]);
  return {draft,ready,message,conflict,saving,change,flush,reload:(preferServer=false)=>load(preferServer)};
}
