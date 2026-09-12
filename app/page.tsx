'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Dice5, Loader2, Pencil, Plus, Soup, Users, Trophy, ExternalLink, Trash2, Undo2, Vote as VoteIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Catalog, Restaurant, Room, VotingMode } from '@/lib/types';
import { FoodOrders } from '@/components/food-orders';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(payload?: Record<string, unknown>, room?: string): Promise<T> {
  const response = await fetch(`/api/game${room ? `?room=${encodeURIComponent(room)}` : ''}`, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(value.error || '暂时无法完成，请重试。', response.status);
  return value;
}
function FoodArt({ small = false }: { small?: boolean }) {
  return <img className={small ? 'food-art small-art' : 'food-art'} src="/food-collage.png" alt="汉堡、炸鸡和小笼包的拼贴插画" width="1254" height="1254" />;
}
function RestaurantEditor({ item, close, saved }: { item: Partial<Restaurant>; close: () => void; saved: (c: Catalog) => void }) {
  const [name, setName] = useState(item.name || '');
  const [cuisine, setCuisine] = useState(item.cuisine || '');
  const [address, setAddress] = useState(item.address || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Dialog open onOpenChange={open => !open && !busy && close()}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>{item.id ? '修改餐馆' : '添加一家餐馆'}</DialogTitle><DialogDescription>用你们熟悉的名字就好。保存后，大家都能选到这家餐馆。</DialogDescription></DialogHeader>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { saved(await api<Catalog>({ action: 'saveRestaurant', id: item.id, name, cuisine, address })); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label className="field">餐馆名称<Input autoFocus required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="例如：Kung Fu BBQ（盒饭）" /></label>
      <label className="field">类型 <span>选填</span><Input maxLength={40} value={cuisine} onChange={e => setCuisine(e.target.value)} placeholder="例如：中餐 · 盒饭" /></label>
      <label className="field">地址 <span>选填</span><Input maxLength={160} value={address} onChange={e => setAddress(e.target.value)} placeholder="方便大家找到同一家店" /></label>
      {error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Check />}保存餐馆</Button>
    </form>
  </DialogContent></Dialog>;
}
function RoomView({ room, setRoom, home }: { room: Room; setRoom: (r: Room) => void; home: () => void }) {
  const [nickname, setNickname] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [share, setShare] = useState(false), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false);
  const [displayNumber, setDisplayNumber] = useState('？');
  const [candidateId, setCandidateId] = useState('');
  const linkRef = useRef<HTMLInputElement>(null);
  const mine = room.candidates.find(r => r.id === room.myVote?.candidate_id);
  const winner = room.candidates.find(r => r.id === room.winner_id);
  const highest = Math.max(0, ...room.candidates.map(r => r.count || 0));
  const tied = room.candidates.filter(r => r.count === highest).length;
  const ranked = [...room.candidates].sort((a, b) => (b.count || 0) - (a.count || 0) || a.position - b.position);
  const closed = room.status === 'closed';
  const manual = room.mode === 'manual';
  async function vote(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    if (manual && !candidateId) { setError('请先选择一家想吃的餐馆。'); return; }
    setBusy(true); setError('');
    const animation = manual ? undefined : window.setInterval(() => setDisplayNumber(String(1 + Math.floor(Math.random() * room.candidates.length))), 90);
    try {
      const payload = { action: 'vote', room: room.id, nickname, ...(manual ? {candidateId} : {}) };
      if (manual) setRoom(await api<Room>(payload));
      else { const [r] = await Promise.all([api<Room>(payload), new Promise(resolve => setTimeout(resolve, 1000))]); setRoom(r); }
    }
    catch (e) { setError((e as Error).message); }
    finally { clearInterval(animation); setBusy(false); }
  }
  return <>
    <div className="room-top"><Button variant="ghost" className="back" onClick={home}><ArrowLeft />餐馆清单</Button><Button variant="outline" className="secondary" onClick={() => { setCopied(false); setShare(true); }}><Copy />邀请群友</Button></div>
    <section className="room-heading"><div><h1>{room.title}</h1><p>{closed ? '目的地已定，出发吧。' : manual ? '每人选一家想吃的餐馆，票数最多的就是目的地。' : '每人随机抽一家，让大家的运气一起决定。'}</p></div><div className="room-badges"><span className="mode-badge">{manual ? '自主投票' : '随机抽签'}</span><span className={`status ${closed ? 'ended' : ''}`}>{closed ? '已结束' : '正在投票'}</span></div></section>
    <div className="room-grid"><section className={`draw-panel ${closed ? 'winner-panel' : ''}`} aria-live="polite">
      {closed && winner ? <><Trophy className="large-icon" /><p className="draw-label">今天就吃这家</p><h2>{winner.name}</h2><p>{winner.count} 票 · {tied > 1 ? `${tied} 家平票，已随机选出` : '本轮票数最高'}</p>{winner.address && <p className="winner-address">{winner.address}</p>}{winner.source && <a className="source-link" href={winner.source} target="_blank" rel="noreferrer">查看餐馆官网 <ExternalLink size={14} /></a>}<FoodArt small /></>
      : mine ? <><div className="draw-number">{manual ? <Check /> : String(mine.position).padStart(2, '0')}</div><p className="draw-label">{manual ? '你已投票给' : '你的随机号码，已自动投票给'}</p><h2>{mine.name}</h2><p className="voted"><Check size={18} />{room.myVote?.nickname}，这一票已计入</p><p className="muted">等群友到齐，由发起人结束投票。</p></>
      : manual ? <><div className="draw-number"><VoteIcon /></div><h2>今天你想吃哪家？</h2><p>选一家心仪的餐馆，给它投一票。</p><form onSubmit={vote}><label className="field">你的群昵称<Input required maxLength={24} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="让朋友知道你来啦" disabled={busy} /></label><fieldset className="ballot-field" disabled={busy}><legend>选择一家餐馆</legend><div className="ballot-options">{room.candidates.map(candidate => <label key={candidate.id} className={`ballot-option ${candidateId === candidate.id ? 'chosen' : ''}`}><input type="radio" name="candidate" required value={candidate.id} checked={candidateId === candidate.id} onChange={() => setCandidateId(candidate.id)} /><span><strong>{candidate.name}</strong><small>{candidate.cuisine || '自定义餐馆'}{candidate.address && ` · ${candidate.address}`}</small></span></label>)}</div></fieldset><Button className="primary full" disabled={busy || !candidateId}>{busy ? <Loader2 className="spin" /> : <VoteIcon />}{busy ? '正在投票…' : '确认投票'}</Button></form><p className="fine-print">每人一票，提交后不能更改。请使用自己的群昵称。</p></>
      : <><div className={`draw-number ${busy ? 'drawing' : ''}`}>{busy ? displayNumber : <Dice5 />}</div><h2>轮到你的好运了</h2><p>抽到几号，就给几号餐馆投一票。</p><form onSubmit={vote}><label className="field">你的群昵称<Input required maxLength={24} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="让朋友知道你来啦" disabled={busy} /></label><Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Dice5 />}{busy ? '正在抽签…' : '随机抽签并投票'}</Button></form><p className="fine-print">同一浏览器每轮限投一次，请使用自己的群昵称。</p></>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="results"><div className="section-heading"><h2>{closed ? '最终票数' : '实时票数'}</h2><span className="count"><Users size={17} />{room.total} 人已投</span></div>
      {!room.total && <p className="empty-hint">还没有人投票，来当第一个吧。</p>}
      <ol className="vote-list">{ranked.map(r => <li key={r.id} className={r.id === room.winner_id ? 'winner-row' : ''}><div className="result-label"><span className="candidate-number">{String(r.position).padStart(2, '0')}</span><strong>{r.name}{r.id === room.winner_id && <Trophy size={16} />}</strong><span>{r.count} 票</span></div><div className="bar-track"><div className="bar-fill" style={{ width: `${room.total ? (r.count || 0) / room.total * 100 : 0}%` }} /></div></li>)}</ol>
      <p className="fine-print">{manual ? '每人选择一家餐馆，得票最多的获胜。' : '所有候选餐馆被抽中的机会相同。'}票数每 4 秒自动更新。</p>
      {room.isHost && !closed && <div className="host-actions"><Button variant="outline" className="secondary full" disabled={!room.total || busy} onClick={() => setConfirm(true)}>结束投票，决定去哪家</Button><p className="fine-print">仅你作为发起人可以结束；平票时随机选一家。</p></div>}
      {!room.isHost && !closed && <p className="host-note">大家投完后，由发起人结束本轮。</p>}
    </section></div>
    {closed && <FoodOrders room={room} update={setRoom} />}
    {!!room.votes.length && <section className="participants"><h2>{manual ? '饭搭子都投给了谁' : '饭搭子都抽到了什么'}</h2><div className="participant-list">{room.votes.map((v, i) => <div className="participant" key={`${v.nickname}-${i}`}><span className="avatar">{Array.from(v.nickname)[0]}</span><span><strong>{v.nickname}</strong><span>{room.candidates.find(c => c.id === v.candidate_id)?.name}</span></span></div>)}</div></section>}
    <Dialog open={share} onOpenChange={setShare}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>叫上群里的饭搭子</DialogTitle><DialogDescription>复制链接，粘贴到微信群。朋友打开就能参与本轮。</DialogDescription></DialogHeader><Input aria-label="本轮投票链接" readOnly ref={linkRef} value={typeof window !== 'undefined' ? window.location.href : ''} onFocus={e => e.target.select()} /><Button className="primary full" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { linkRef.current?.focus(); linkRef.current?.select(); setCopied(false); } }}>{copied ? <Check /> : <Copy />}{copied ? '已复制，去微信粘贴吧' : '复制投票链接'}</Button><p className="fine-print">也可以长按上面的链接复制。拥有链接的人可以参与并查看昵称与票数。</p></DialogContent></Dialog>
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>大家都投完了吗？</DialogTitle><DialogDescription>结束后不再接收新票。得票最多的餐馆获胜；平票就在并列餐馆中随机选一家。</DialogDescription></DialogHeader><Button className="primary full" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setRoom(await api<Room>({ action: 'close', room: room.id })); setConfirm(false); } catch (e) { setError((e as Error).message); setConfirm(false); } finally { setBusy(false); } }}>{busy ? '正在决定…' : '确认结束，开饭！'}</Button></DialogContent></Dialog>
  </>;
}
export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [room, setRoom] = useState<Room | null>(null);
  const [roomId, setRoomId] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editor, setEditor] = useState<Partial<Restaurant> | null>(null), [creating, setCreating] = useState(false), [title, setTitle] = useState('今晚吃什么？'), [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Restaurant | null>(null), [lastDeleted, setLastDeleted] = useState<Restaurant | null>(null), [deleteError, setDeleteError] = useState('');
  const [mode, setMode] = useState<VotingMode>('random');
  const catalogEpoch = useRef(0);
  const currentRoom = useRef('');
  const unavailableRoom = useRef('');
  const acceptRoom = useCallback((incoming: Room) => {
    if (incoming.id !== currentRoom.current || incoming.id === unavailableRoom.current) return;
    setRoom(previous => previous?.id === incoming.id && previous.revision > incoming.revision ? previous : incoming);
  }, []);
  const acceptCatalog = useCallback((incoming: Catalog) => {
    setCatalog(previous => ({ ...incoming, restaurants: incoming.restaurants.map(r => ({ ...r, selected: previous?.restaurants.find(p => p.id === r.id)?.selected ?? r.selected })) }));
  }, []);
  const catalogChanged = useCallback((incoming: Catalog) => { catalogEpoch.current++; acceptCatalog(incoming); }, [acceptCatalog]);
  const load = useCallback(async (id: string) => {
    const epoch = catalogEpoch.current;
    currentRoom.current = id; setRoomId(id); setRoom(null); setLoading(true); setError('');
    try { if (id) { const r = await api<Room>(undefined, id); if (currentRoom.current === id) { unavailableRoom.current = ''; acceptRoom(r); } } else { const c = await api<Catalog>(); if (!currentRoom.current && epoch === catalogEpoch.current) { acceptCatalog(c); setRoom(null); } } }
    catch (e) { if (currentRoom.current === id) { if (id && e instanceof ApiError && e.status === 404) { unavailableRoom.current = id; setRoom(null); } setError((e as Error).message); } }
    finally { if (currentRoom.current === id) setLoading(false); }
  }, [acceptRoom, acceptCatalog]);
  useEffect(() => { const update = () => load(new URLSearchParams(window.location.search).get('room') || ''); update(); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, [load]);
  useEffect(() => { if (!roomId) return; let cancelled = false; let running = false; const timer = window.setInterval(async () => { if (running || document.hidden) return; running = true; try { const r = await api<Room>(undefined, roomId); if (!cancelled) { unavailableRoom.current = ''; acceptRoom(r); setError(''); } } catch (e) { if (!cancelled) { if (e instanceof ApiError && e.status === 404) { unavailableRoom.current = roomId; setRoom(null); setError(e.message); } else setError('连接暂时中断，正在自动重连。'); } } finally { running = false; } }, 4000); return () => { cancelled = true; clearInterval(timer); }; }, [roomId, acceptRoom]);
  useEffect(() => { if (roomId) return; let cancelled = false; const timer = window.setInterval(async () => { if(document.hidden) return; const epoch = catalogEpoch.current; try { const c = await api<Catalog>(); if(!cancelled && !currentRoom.current && epoch === catalogEpoch.current) acceptCatalog(c); } catch {} }, 8000); return () => {cancelled=true;clearInterval(timer);}; }, [roomId,acceptCatalog]);
  function navigate(id = '') { window.history.pushState({}, '', id ? `/?room=${id}` : '/'); load(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const selected = catalog?.restaurants.filter(r => r.selected).length || 0;
  return <div className="app-shell"><header className="site-header"><a href="/" className="brand" onClick={e => { e.preventDefault(); navigate(); }}><Soup aria-hidden="true" /><span>饭点</span></a><span className="location">Champaign · Urbana</span><nav className="site-nav" aria-label="主导航"><a className="nav-link active" href={roomId ? '/' : '#restaurants'} onClick={e => { if (roomId) { e.preventDefault(); navigate(); } }}>餐馆清单</a><a className="nav-link" href="/history">历史记录</a></nav></header>
    <main>{error && <div className="error page-error" role="alert">{error}<Button variant="ghost" onClick={() => load(roomId)}>重试</Button></div>}
      {loading ? <div className="loading"><Loader2 className="spin" /><p>正在准备餐桌…</p></div> : roomId ? room && room.id === roomId && <RoomView key={room.id} room={room} setRoom={acceptRoom} home={() => navigate()} /> : catalog && <>
        <section className="intro"><div className="intro-copy"><h1>今天吃什么？</h1><p>自己投票，或随机抽签，<br className="mobile-break" />票数最多的就是今晚的目的地。</p></div><FoodArt /><div className="intro-action"><Button className="primary" disabled={selected < 2 || busy} onClick={() => { setError(''); setCreating(true); }}>创建一轮投票 <ArrowRight /></Button><span>{selected >= 2 ? '建好后，把链接发到微信群' : '请先选中至少两家餐馆'}</span></div></section>
        <section id="restaurants" className="catalog"><div className="section-heading"><div><h2>餐馆清单</h2><p>共享餐馆库 · 本轮已选 {selected} 家</p></div><Button variant="outline" className="secondary" onClick={() => setEditor({})}><Plus />添加餐馆</Button></div>
          {lastDeleted && <div className="delete-notice" role="status"><span>已删除「{lastDeleted.name}」</span><Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const restored = await api<Catalog>({ action: 'restoreRestaurant', id: lastDeleted.id }); catalogChanged({ ...restored, restaurants: restored.restaurants.map(r => r.id === lastDeleted.id ? { ...r, selected: lastDeleted.selected } : r) }); setLastDeleted(null); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}><Undo2 />撤销</Button></div>}
          {!catalog.restaurants.length && <p className="catalog-empty">还没有餐馆，点击「添加餐馆」开始吧。</p>}
          <div className="restaurant-list">{catalog.restaurants.map((r, i) => <div className={`restaurant-row ${!r.selected ? 'excluded' : ''}`} key={r.id}><Checkbox aria-label={`选择 ${r.name}`} checked={!!r.selected} disabled={busy} onCheckedChange={checked => setCatalog(previous => previous && ({ ...previous, restaurants: previous.restaurants.map(item => item.id === r.id ? { ...item, selected: checked ? 1 : 0 } : item) }))} /><span className="row-number">{String(i + 1).padStart(2, '0')}</span><div className="restaurant-info"><strong>{r.name}</strong><span>{r.cuisine || '自定义餐馆'}</span></div><div className="restaurant-address">{r.address || '可以补充你们熟悉的店名和地址'}</div>{r.source && <a href={r.source} target="_blank" rel="noreferrer" aria-label={`${r.name} 官网`} className="icon-button source-icon"><ExternalLink size={17} /></a>}<Button variant="ghost" size="icon" className="icon-button" aria-label={`修改 ${r.name}`} onClick={() => setEditor(r)}><Pencil size={17} /></Button><Button variant="ghost" className="restaurant-delete" aria-label={`删除 ${r.name}`} disabled={busy} onClick={() => { setDeleteError(''); setDeleting(r); }}><Trash2 size={16} /><span>删除</span></Button></div>)}</div>
          <p className="catalog-note">人人都能添加、改名和删除；勾选只影响你创建的下一轮。已开始的投票名单保持不变。</p>
        </section>
        {!!catalog.rooms.length && <section className="recent"><div className="recent-heading"><h2>我发起的投票</h2><a href="/history">查看全部历史<ArrowRight size={16} /></a></div>{catalog.rooms.map(r => <button key={r.id} onClick={() => navigate(r.id)}><span>{r.title}</span><span>{r.status === 'closed' ? '已结束' : '投票中'}<ArrowRight size={17} /></span></button>)}</section>}
      </>}
    </main><footer><span>饭点 · 和饭搭子一起，少纠结一顿。</span><span>自主投票 · 随机抽签</span></footer>
    {editor && <RestaurantEditor item={editor} close={() => setEditor(null)} saved={catalogChanged} />}
    <AlertDialog open={!!deleting} onOpenChange={open => !open && !busy && setDeleting(null)}><AlertDialogContent className="editor-dialog"><AlertDialogHeader><AlertDialogTitle>删除这家餐馆？</AlertDialogTitle><AlertDialogDescription>「{deleting?.name}」会从大家共用的餐馆库中移除，之后的新投票不再可选。已开始的投票、结果和带饭记录不受影响。删除后可点击「撤销」恢复。</AlertDialogDescription></AlertDialogHeader>{deleteError && <p className="error" role="alert">{deleteError}</p>}<AlertDialogFooter><AlertDialogCancel className="secondary" disabled={busy}>取消</AlertDialogCancel><AlertDialogAction className="delete-confirm" variant="destructive" disabled={busy} onClick={async e => { e.preventDefault(); if(!deleting) return; setBusy(true); setDeleteError(''); try { catalogChanged(await api<Catalog>({ action:'deleteRestaurant', id:deleting.id })); setLastDeleted(deleting); setDeleting(null); } catch(e) { setDeleteError((e as Error).message); } finally { setBusy(false); } }}>{busy ? '正在删除…' : '确认删除'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={creating} onOpenChange={open => !busy && setCreating(open)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>今天这顿，你来组局</DialogTitle><DialogDescription>本轮包含已选的 {selected} 家餐馆。{mode === 'manual' ? '每人自主选择一家餐馆投票。' : '每人随机抽一家餐馆并自动投票。'}</DialogDescription></DialogHeader><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { const r = await api<Room>({ action: 'create', title, mode, restaurantIds: catalog?.restaurants.filter(r => r.selected).map(r => r.id) }); setCreating(false); window.history.pushState({}, '', `/?room=${r.id}`); currentRoom.current = r.id; setRoomId(r.id); acceptRoom(r); window.scrollTo({ top: 0 }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><label className="field">这轮投票的名字<Input required maxLength={60} value={title} onChange={e => setTitle(e.target.value)} /></label><fieldset className="mode-field" disabled={busy}><legend>选择本轮玩法</legend><div className="mode-options"><label className={`mode-option ${mode === 'manual' ? 'chosen' : ''}`}><input type="radio" name="voting-mode" value="manual" checked={mode === 'manual'} onChange={() => setMode('manual')} /><VoteIcon aria-hidden="true" /><span><strong>自主投票</strong><small>每人自己选一家想吃的餐馆</small></span></label><label className={`mode-option ${mode === 'random' ? 'chosen' : ''}`}><input type="radio" name="voting-mode" value="random" checked={mode === 'random'} onChange={() => setMode('random')} /><Dice5 aria-hidden="true" /><span><strong>随机抽签</strong><small>每人随机抽一家，自动计一票</small></span></label></div><p className="fine-print">两种玩法均为一人一票，最高票获胜；平票时随机选一家。创建后玩法固定。</p></fieldset>{error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />}{busy ? '正在创建…' : '创建投票，叫上大家'}</Button><p className="fine-print">请保留此浏览器，之后用它结束本轮投票。</p></form></DialogContent></Dialog>
  </div>;
}
