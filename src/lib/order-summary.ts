import type {FoodOrder,PersonalOrder} from './types';
export function orderStatus(order:Pick<FoodOrder,'status'|'purchase_status'|'claimant_name'>) {
  if(order.status==='delivered')return `${order.claimant_name||'带饭人'} 已带回`;
  if(order.status==='pending')return '待认领';
  if(order.purchase_status==='sold_out')return `${order.claimant_name||'带饭人'}：菜品售罄，需要换菜`;
  return `${order.claimant_name||'带饭人'} ${order.purchase_status==='ordered'?'已下单':'已认领，尚未下单'}`;
}
export function groupOrders(orders:FoodOrder[]) {
  const groups=new Map<string,{dish:string;note:string;quantity:number;recipients:{name:string;quantity:number}[]}>();
  for(const order of orders){
    // Do not infer equivalent tastes or collapse different allergy/ingredient notes.
    const key=JSON.stringify([order.dish,order.note]);
    let group=groups.get(key);if(!group){group={dish:order.dish,note:order.note,quantity:0,recipients:[]};groups.set(key,group);}
    group.quantity+=order.quantity;group.recipients.push({name:order.nickname,quantity:order.quantity});
  }
  return [...groups.values()];
}
export function personalOrderText(order:PersonalOrder){return `${order.dish} × ${order.quantity} · ${orderStatus(order)}${order.status!=='pending'?` · ${order.pickup_time||'时间待确认'}${order.pickup_time?'（香槟时间）':''} · ${order.pickup_place||'地点待确认'}`:''}${order.change_request?' · 改单申请待确认':''}`;}
