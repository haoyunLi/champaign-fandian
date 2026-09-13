export type OrderDraft={orderId:string;nickname:string;dish:string;quantity:string;note:string};
export function parseOrderDraft(raw:string|null):OrderDraft|null {
  try {
    const d=JSON.parse(raw||'null');
    if(!d||typeof d.orderId!=='string'||!/^[a-f0-9-]{36}$/.test(d.orderId)||typeof d.nickname!=='string'||d.nickname.length>24||typeof d.dish!=='string'||d.dish.length>100||typeof d.note!=='string'||d.note.length>240||typeof d.quantity!=='string'||d.quantity.length>10)return null;
    return {orderId:d.orderId,nickname:d.nickname,dish:d.dish,quantity:d.quantity,note:d.note};
  }catch{return null;}
}
