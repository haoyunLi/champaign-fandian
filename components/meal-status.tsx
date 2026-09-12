'use client';
import { useEffect, useState } from 'react';
import type { MealLifecycle } from '@/lib/types';

type PhaseInfo=Pick<MealLifecycle,'phase'|'delivery_deadline_at'>;
export function useMealPhase(meal: PhaseInfo) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    if(meal.phase!=='delivery' || !meal.delivery_deadline_at) return;
    const delay=Date.parse(meal.delivery_deadline_at)-Date.now();
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(0,Math.min(delay+20,2147483647)));
    return ()=>window.clearTimeout(timer);
  },[meal.phase,meal.delivery_deadline_at]);
  return meal.phase==='delivery' && meal.delivery_deadline_at && Date.parse(meal.delivery_deadline_at)<=now ? 'finished' : meal.phase;
}
export function MealStatus({meal}:{meal:PhaseInfo}) {
  const phase=useMealPhase(meal);
  return <span className={`status ${phase==='finished'?'ended':phase==='delivery'?'delivering':''}`}>{phase==='finished'?'已结束':phase==='delivery'?'带饭中':'投票中'}</span>;
}
export function deadlineLabel(value:string|null) {
  return value ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
}
