'use client';
import {useEffect,useState} from 'react';
import {formatMealDateTime} from '@/lib/meal-date';
export function VotingTimer({deadline}: {deadline:string|null}) {
  const [now,setNow]=useState<number|null>(null);
  useEffect(()=>{if(!deadline)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[deadline]);
  if(!deadline)return null;
  const left=now===null?null:Math.max(0,Math.ceil((Date.parse(deadline)-now)/1000));
  return <div className="voting-deadline"><strong>投票截止：{formatMealDateTime(deadline)}（香槟时间）</strong><p>{left===null?'到点自动确定结果，任何人仍可提前结束。':left===0?'投票时间已到，正在读取最终结果…':`还剩 ${Math.floor(left/3600)} 小时 ${Math.floor(left%3600/60)} 分 ${left%60} 秒 · 到点自动确定结果`}</p></div>;
}
