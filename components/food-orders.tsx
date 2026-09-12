'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, HandHeart, Loader2, Plus, ShoppingBag, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { FoodOrder, Room } from '@/lib/types';
import { deadlineLabel, useMealPhase } from '@/components/meal-status';

export function FoodOrders({ room, update }: { room: Room; update: (r: Room) => void }) {
  const [adding, setAdding] = useState(false), [claim, setClaim] = useState<FoodOrder | null>(null), [cancel, setCancel] = useState<FoodOrder | null>(null);
  const [nickname, setNickname] = useState(room.myVote?.nickname || ''), [carrier, setCarrier] = useState(room.myVote?.nickname || '');
  const [dish, setDish] = useState(''), [quantity, setQuantity] = useState('1'), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const orderId = useRef('');
  const winner = room.candidates.find(r => r.id === room.winner_id);
  const count = room.orders.reduce((n, o) => n + o.quantity, 0);
  const pending = room.orders.filter(o => o.status === 'pending').length;
  const phase=useMealPhase(room), finished=phase==='finished';
  const delivered=room.orders.filter(o=>o.status==='delivered').length;
  useEffect(()=>{ if(finished) { setAdding(false); setClaim(null); setCancel(null); } },[finished]);
  async function act(payload: Record<string, unknown>) {
    if(finished) { setError('本轮饭局已结束，带饭清单可继续查看。'); return false; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: room.id, ...payload }) });
      const value = await response.json() as Room & { error?: string };
      if (!response.ok) throw new Error(value.error || '暂时无法保存，请重试。');
      update(value); return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  return <section className="food-orders" id="food-orders"><div className="section-heading"><div><h2><ShoppingBag />带饭清单</h2><p>{winner?.name} · {room.orders.length} 条登记 / {count} 份{pending ? ` · ${pending} 条${finished?'未认领':'待认领'}` : ''}</p></div>{!finished && <Button className="primary order-cta" onClick={() => { orderId.current = crypto.randomUUID(); setError(''); setAdding(true); }}><Plus />帮我带一份</Button>}</div>
    <div className={`meal-progress ${finished?'meal-finished':''}`} role="status"><strong>{finished ? room.completion_reason==='delivered' ? '全部带饭已带回，本轮结束' : '确定餐馆已满 12 小时，本轮自动结束' : `带饭进行中 · ${delivered} / ${room.orders.length} 条已带回`}</strong><p>{finished ? '投票结果和带饭记录已保留，未完成的登记不会被标成已带回。' : `所有登记都标记「已带回」后结束；否则将在 ${deadlineLabel(room.delivery_deadline_at)} 自动结束（确定餐馆起 12 小时）。`}</p></div>
    {!finished && <p className="order-explainer">今天去不了？写下想吃的菜，去的朋友可以认领。这里只登记带饭，菜品是否有售、价格和付款请在群里确认。</p>}
    {!room.orders.length ? <div className="orders-empty"><HandHeart /><div><strong>{finished?'本轮没有带饭登记':'人不在，也能一起开饭。'}</strong><p>{finished?'可以从历史记录查看本轮投票结果。':'还没有带饭登记。填好菜名和备注，等朋友认领吧。'}</p></div></div> : <div className="orders-list">{room.orders.map(o => <article className={`order-row order-${o.status}`} key={o.id}><div className="order-main"><div className="order-title"><strong>{o.dish}</strong><span>× {o.quantity}</span></div><p><b>{o.nickname}</b> 想吃{o.isMine && <span className="mine-label">我的登记</span>}</p>{o.note && <p className="order-note">{o.note}</p>}</div><div className="order-actions"><span className={`order-status ${o.status}`}>{o.status === 'pending' ? finished?'未认领（本轮已结束）':'等人带饭' : o.status === 'claimed' ? finished?`${o.claimant_name} 认领，尚未标记带回`:`${o.claimant_name} 来带` : `${o.claimant_name} 已带回`}</span>{!finished && <div className="order-buttons">{o.status === 'pending' && <Button className="secondary" variant="outline" disabled={busy} onClick={() => { setError(''); setClaim(o); }}><HandHeart />我来带</Button>}{o.status === 'pending' && o.isMine && <Button size="icon" variant="ghost" aria-label={`取消 ${o.dish}`} disabled={busy} onClick={() => { setError(''); setCancel(o); }}><X /></Button>}{o.status === 'claimed' && o.canManage && <><Button className="secondary" variant="outline" disabled={busy} onClick={() => act({ action: 'deliver', orderId: o.id })}><Check />已带回</Button><Button size="icon" variant="ghost" aria-label={`取消认领 ${o.dish}`} disabled={busy} onClick={() => act({ action: 'release', orderId: o.id })}><Undo2 /></Button></>}</div>}</div></article>)}</div>}
    {error && !adding && !claim && !cancel && <p className="error" role="alert">{error}</p>}
    <Dialog open={adding} onOpenChange={open => !busy && setAdding(open)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>我不去，帮我带饭</DialogTitle><DialogDescription>这次从 {winner?.name} 带。请填写具体菜名，朋友才好帮你买。</DialogDescription></DialogHeader><form onSubmit={async e => { e.preventDefault(); if (await act({ action: 'order', orderId: orderId.current, nickname, dish, quantity: Number(quantity), note })) { setAdding(false); setDish(''); setQuantity('1'); setNote(''); } }}><label className="field">你的群昵称<Input required maxLength={24} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="例如：小李" /></label><label className="field">想吃什么<Input required maxLength={100} value={dish} onChange={e => setDish(e.target.value)} placeholder="例如：宫保鸡丁盒饭" /></label><label className="field">份数<Input type="number" required min={1} max={20} step={1} inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label className="field">备注 <span>选填</span><Textarea maxLength={240} value={note} onChange={e => setNote(e.target.value)} placeholder="口味、忌口、取餐地点；例如少辣，在实验室等" /></label>{error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <ShoppingBag />}{busy ? '正在登记…' : '加入带饭清单'}</Button><p className="fine-print">已有人认领后，如需改菜，请在群里联系带饭人。</p></form></DialogContent></Dialog>
    <Dialog open={!!claim} onOpenChange={open => !open && !busy && setClaim(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>这份我来带</DialogTitle><DialogDescription>帮 {claim?.nickname} 带 {claim?.dish} × {claim?.quantity}。认领后，大家会看到你的名字。</DialogDescription></DialogHeader><form onSubmit={async e => { e.preventDefault(); if (await act({ action: 'claim', orderId: claim?.id, nickname: carrier })) setClaim(null); }}><label className="field">带饭人的群昵称<Input required maxLength={24} value={carrier} onChange={e => setCarrier(e.target.value)} /></label>{error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy}>确认，我来带</Button></form></DialogContent></Dialog>
    <Dialog open={!!cancel} onOpenChange={open => !open && !busy && setCancel(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>取消这条带饭登记？</DialogTitle><DialogDescription>{cancel?.dish} × {cancel?.quantity} 将从清单移除。需要时可以重新登记。</DialogDescription></DialogHeader>{error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy} onClick={async () => { if (await act({ action: 'cancelOrder', orderId: cancel?.id })) setCancel(null); }}>确认取消</Button></DialogContent></Dialog>
  </section>;
}
