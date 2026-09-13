import type { Room } from '@/lib/types';
import { formatMealDateTime } from '@/lib/meal-date';
export function mealShareText(room:Room,url:string,now=new Date()) {
  const phase=room.phase==='delivery'&&room.delivery_deadline_at&&Date.parse(room.delivery_deadline_at)<=now.getTime()?'finished':room.phase;
  const winner=room.candidates.find(r=>r.id===room.winner_id);
  const pending=room.orders.filter(o=>o.status==='pending'),claimed=room.orders.filter(o=>o.status==='claimed'),delivered=room.orders.filter(o=>o.status==='delivered');
  const lines=[`【${room.title}】`,`${room.creator_name} 发起 · ${room.mode==='manual'?'自主投票':'随机抽签'}`];
  if(phase==='voting')lines.push(`正在投票：${room.total} 人已投`,`候选：${room.candidates.map(c=>c.name).join('、')}`);
  else if(room.completion_reason==='no_votes')lines.push('截止前无人投票，本轮未产生结果。');
  else{
    lines.push(`已选餐馆：${winner?.name||'已确定'}`,phase==='finished'?room.completion_reason==='delivered'?'已全部带回，本轮结束':'本轮已到期结束，未完成登记请联系带饭人':room.orders_stopped_at?'已停止加单，处理已有登记':'仍可登记带饭');
    lines.push(`待认领 ${pending.length} 条（${pending.reduce((n,o)=>n+o.quantity,0)} 份） · 已认领 ${claimed.length} 条 · 已带回 ${delivered.length} 条`);
    const carriers=[...new Set(claimed.map(o=>o.claimant_name||'未设置昵称'))];
    lines.push(`已下单 ${claimed.filter(o=>o.purchase_status==='ordered').length} 条 · 售罄待换菜 ${claimed.filter(o=>o.purchase_status==='sold_out').length} 条 · 改单待确认 ${claimed.filter(o=>o.change_request).length} 条`);
    lines.push(`正在带饭：${carriers.length?carriers.join('、'):'暂无'}`);
    const plans=[...new Set([...claimed,...delivered].filter(o=>o.pickup_time||o.pickup_place).map(o=>`${o.claimant_name||'带饭人'}：${o.pickup_time?`${o.pickup_time}（香槟时间）`:'时间待确认'} · ${o.pickup_place||'地点待确认'}`))];
    if(plans.length)lines.push('取餐安排：',...plans);
  }
  lines.push(`更新于 ${formatMealDateTime(now.toISOString())}（香槟时间）`,url);
  return lines.join('\n');
}
