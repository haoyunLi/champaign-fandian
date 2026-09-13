'use client';
import { PersonalUpdates } from '@/components/personal-updates';
import { VotingTimer } from '@/components/voting-timer';
import { champaignInput,deadlineFromChampaign } from '@/lib/voting-deadline';
import { personalOrderText } from '@/lib/order-summary';
import { gameFetch } from '@/lib/game-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Dice5, Loader2, Pencil, Plus, Soup, Users, Trophy, Trash2, Undo2, BookmarkPlus, Vote as VoteIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Catalog, HomeMeal, Restaurant, Room, VotingMode, Profile } from '@/lib/types';
import { UserProfile, MemberList } from '@/components/user-profile';
import { RestaurantEditor, RestaurantLinks } from '@/components/restaurant-media';
import { FoodOrders, type FoodOrdersHandle } from '@/components/food-orders';
import { RestaurantPools } from '@/components/restaurant-pools';
import { ShareMealStatus } from '@/components/share-meal-status';
import { ReplayButton } from '@/components/replay-button';
import { MealStatus, useMealPhase } from '@/components/meal-status';
import { formatMealDateTime } from '@/lib/meal-date';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(payload?: Record<string, unknown>, room?: string): Promise<T> {
  const response = await gameFetch(`/api/game${room ? `?room=${encodeURIComponent(room)}` : ''}`, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(value.error || '暂时无法完成，请重试。', response.status);
  return value;
}
function FoodArt({ small = false }: { small?: boolean }) {
  return <img className={small ? 'food-art small-art' : 'food-art'} src="/food-collage.png" alt="汉堡、炸鸡和小笼包的拼贴插画" width="1254" height="1254" />;
}
function HomeMealCard({ meal, open }: { meal: HomeMeal; open: (id: string) => void }) {
  return <button className="active-meal" onClick={() => open(meal.id)}>
    <span className="active-meal-main">
      <span className="active-meal-title"><strong>{meal.title}</strong><MealStatus meal={meal}/></span>
      <span className="active-meal-detail">{meal.creator_name} 发起{meal.isHost ? '（我）' : ''} · {meal.winner_name || (meal.completion_reason==='no_votes'?'未产生结果':`${meal.vote_count} 人已投`)}</span>
      <span className="home-meal-date">发起于 <time dateTime={meal.created_at}>{formatMealDateTime(meal.created_at)}</time> · 香槟时间</span>
      {meal.my_orders?.length>0&&<span className="home-personal-orders">{meal.my_orders.slice(0,2).map(o=><span key={o.id}>{personalOrderText(o)}</span>)}{meal.my_orders.length>2&&<span>另有 {meal.my_orders.length-2} 条，点开查看</span>}</span>}
      {meal.phase !== 'voting' && meal.completion_reason!=='no_votes' && <>
        {meal.orders_stopped_at && meal.phase!=='finished' && <span className="home-meal-outcome">已停止加单 · 继续处理已登记的带饭</span>}
        {meal.order_count ? <span className="home-order-counts">
          <span className={meal.pending_count ? 'has-pending' : ''}>待认领 <b>{meal.pending_count}</b> 条</span>
          <span className={meal.claimed_count ? 'has-claimed' : ''}>已认领 <b>{meal.claimed_count}</b> 条</span>
          <span className={meal.delivered_count ? 'has-delivered' : ''}>已带回 <b>{meal.delivered_count}</b> 条</span>
        </span> : <span className="active-meal-detail">还没有带饭登记</span>}
        {meal.phase === 'finished' && <span className={`home-meal-outcome ${meal.completion_reason === 'delivered' ? 'all-delivered' : ''}`}>{meal.completion_reason === 'delivered' ? '已全部带回' : '已满 12 小时结束，未完成登记保留原状态'}</span>}
      </>}
    </span>
    <span className="active-meal-cta">{meal.phase === 'voting' ? '继续投票' : meal.completion_reason==='no_votes'?'查看结果':'查看带饭'}<ArrowRight size={17}/></span>
  </button>;
}
function RoomView({ room, setRoom, home }: { room: Room; setRoom: (r: Room) => void; home: () => void }) {
  const [nickname, setNickname] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [share, setShare] = useState(false), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false);
  const [displayNumber, setDisplayNumber] = useState('？');
  const [candidateId, setCandidateId] = useState('');
  const [savingHistory, setSavingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const foodRef=useRef<FoodOrdersHandle>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const mine = room.candidates.find(r => r.id === room.myVote?.candidate_id);
  const winner = room.candidates.find(r => r.id === room.winner_id);
  const highest = Math.max(0, ...room.candidates.map(r => r.count || 0));
  const tied = room.candidates.filter(r => r.count === highest).length;
  const ranked = [...room.candidates].sort((a, b) => (b.count || 0) - (a.count || 0) || a.position - b.position);
  const closed = room.status === 'closed';
  const phase = useMealPhase(room);
  const manual = room.mode === 'manual';
  useEffect(()=>{
    if(room.status!=='open'||!room.voting_deadline_at)return;
    const timer=setTimeout(()=>{void api<Room>(undefined,room.id).then(setRoom).catch(()=>setError('截止时间已到，正在等待连接恢复以读取结果。'));},Math.max(0,Math.min(Date.parse(room.voting_deadline_at)-Date.now()+50,2147483647)));
    return()=>clearTimeout(timer);
  },[room.id,room.status,room.voting_deadline_at,setRoom]);
  async function vote(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    if(room.voting_deadline_at&&Date.parse(room.voting_deadline_at)<=Date.now()){setError('投票时间已到，请等待最终结果。');return;}
    if (manual && !candidateId) { setError('请先选择一家想吃的餐馆。'); return; }
    setBusy(true); setError('');
    const animation = manual ? undefined : window.setInterval(() => setDisplayNumber(String(1 + Math.floor(Math.random() * room.candidates.length))), 90);
    try {
      const payload = { action: 'vote', room: room.id, nickname:room.preferred_nickname||nickname, ...(manual ? {candidateId} : {}) };
      if (manual) setRoom(await api<Room>(payload));
      else { const [r] = await Promise.all([api<Room>(payload), new Promise(resolve => setTimeout(resolve, 1000))]); setRoom(r); }
    }
    catch (e) { setError((e as Error).message); }
    finally { clearInterval(animation); setBusy(false); }
  }
  const results=(<section className="results"><div className="section-heading"><h2>{closed ? '最终票数' : '实时票数'}</h2><span className="count"><Users size={17} />{room.total} 人已投</span></div>
      {!room.total && <p className="empty-hint">{closed?'截止前无人投票，本轮未产生结果。':'还没有人投票，来当第一个吧。'}</p>}
      <ol className="vote-list">{ranked.map(r => <li key={r.id} className={r.id === room.winner_id ? 'winner-row' : ''}><div className="result-label"><span className="candidate-number">{String(r.position).padStart(2, '0')}</span><strong>{r.name}{r.id === room.winner_id && <Trophy size={16} />}</strong><span>{r.count} 票</span></div><div className="bar-track"><div className="bar-fill" style={{ width: `${room.total ? (r.count || 0) / room.total * 100 : 0}%` }} /></div><RestaurantLinks restaurant={r} roomId={room.id}/></li>)}</ol>
      <p className="fine-print">{manual ? '每人选择一家餐馆，得票最多的获胜。' : '所有候选餐馆被抽中的机会相同。'}票数每 4 秒自动更新。</p>
      {!closed && <div className="host-actions"><Button variant="outline" className="secondary full" disabled={!room.total || busy} onClick={() => setConfirm(true)}>结束投票，确定餐馆</Button><p className="fine-print">任何持有本轮链接的人都可以结束投票。请先确认大家已投完；至少收到一票后可结束。</p></div>}
    </section>);
  const participants=(!!room.votes.length && <section className="participants"><h2>{manual ? '饭搭子都投给了谁' : '饭搭子都抽到了什么'}</h2><div className="participant-list">{room.votes.map((v, i) => <div className="participant" key={`${v.nickname}-${i}`}><span className="avatar">{Array.from(v.nickname)[0]}</span><span><strong>{v.nickname}</strong><span>{room.candidates.find(c => c.id === v.candidate_id)?.name}</span></span></div>)}</div></section>);
  return <>
    <div className="room-top"><Button variant="ghost" className="back" onClick={home}><ArrowLeft />餐馆清单</Button><Button variant="outline" className="secondary" onClick={() => { setCopied(false); setShare(true); }}><Copy />邀请群友</Button><ShareMealStatus room={room} update={setRoom}/></div>
    {!room.isHost && <div className="room-history-save"><span>{room.inHistory ? '已收录到「我参与的」，下次可从历史记录找回。' : '先保存这轮，下次打开历史记录就能找到。'}</span><Button variant="ghost" disabled={savingHistory || room.inHistory} onClick={async () => { setSavingHistory(true); setHistoryError(''); try { setRoom(await api<Room>({action:'saveHistory',room:room.id})); } catch(e) { setHistoryError((e as Error).message); } finally { setSavingHistory(false); } }}>{savingHistory ? <Loader2 className="spin" /> : room.inHistory ? <Check /> : <BookmarkPlus />}{savingHistory ? '正在保存…' : room.inHistory ? '已保存' : '保存到历史'}</Button></div>}
    {historyError && <p className="error" role="alert">{historyError}</p>}
    <section className="room-heading"><div><h1>{room.title}</h1><p className="creator-line">{room.creator_name} 发起{room.isHost&&" · 我"}</p><p>{room.completion_reason==='no_votes'?'截止前无人投票，本轮未产生结果。':phase==='finished' ? '本轮饭局已结束，结果和带饭清单仍可查看。' : closed ? room.orders_stopped_at ? '已停止加单，继续安排已登记的带饭吧。' : '餐馆已确定，继续登记和安排带饭吧。' : manual ? '每人选一家想吃的餐馆，票数最多的获选。' : '每人随机抽一家，让大家的运气一起决定。'}</p></div><div className="room-badges"><span className="mode-badge">{manual ? '自主投票' : '随机抽签'}</span><MealStatus meal={room} /></div></section>
    {!closed&&<VotingTimer deadline={room.voting_deadline_at}/>}
    {closed&&!winner&&<section className="no-vote-result"><h2>本轮未产生结果</h2><p>截止前没有人投票，可以再发起一轮邀请大家参与。</p><ReplayButton roomId={room.id}/></section>}
    {closed && winner && <><section className="chosen-restaurant"><div className="chosen-heading"><Trophy/><span>本轮选定餐馆</span></div><div className="chosen-content"><div><h2>{winner?.name}</h2><p>{winner?.count} 票 · {tied>1?'平票后随机选定':'本轮票数最高'}{winner?.address&&` · ${winner.address}`}</p></div>{winner&&<RestaurantLinks restaurant={winner} roomId={room.id} prominent onOrder={phase==='delivery'&&!room.orders_stopped_at?mode=>foodRef.current?.openNew(mode):undefined}/>}</div></section><FoodOrders ref={foodRef} room={room} update={setRoom}/>{phase==='finished'&&<div className="room-replay"><span>下次还用这份候选名单？</span><ReplayButton roomId={room.id}/></div>}</>}
    {!closed && <div className="room-grid"><section className={`draw-panel ${closed ? 'winner-panel' : ''}`} aria-live="polite">
      {mine ? <><div className="draw-number">{manual ? <Check /> : String(mine.position).padStart(2, '0')}</div><p className="draw-label">{manual ? '你已投票给' : '你的随机号码，已自动投票给'}</p><h2>{mine.name}</h2><p className="voted"><Check size={18} />{room.myVote?.nickname}，这一票已计入</p><p className="muted">等大家投完后，任何人都可以结束投票、确定餐馆。</p></>
      : manual ? <><div className="draw-number"><VoteIcon /></div><h2>今天你想吃哪家？</h2><p>选一家心仪的餐馆，给它投一票。</p><form id="room-vote-form" onSubmit={vote}><label className="field">你的群昵称<Input required maxLength={24} value={room.preferred_nickname||nickname} readOnly={!!room.preferred_nickname} onChange={e => setNickname(e.target.value)} placeholder="让朋友知道你来啦" disabled={busy} /></label><fieldset className="ballot-field" disabled={busy}><legend>选择一家餐馆</legend><div className="ballot-options">{room.candidates.map(candidate => <div key={candidate.id} className="ballot-candidate"><label className={`ballot-option ${candidateId === candidate.id ? 'chosen' : ''}`}><input type="radio" name="candidate" required value={candidate.id} checked={candidateId === candidate.id} onChange={() => setCandidateId(candidate.id)} /><span><strong>{candidate.name}</strong><small>{candidate.cuisine || '自定义餐馆'}{candidate.address && ` · ${candidate.address}`}</small></span></label><RestaurantLinks restaurant={candidate} roomId={room.id}/></div>)}</div></fieldset><Button className="primary full" disabled={busy || !candidateId}>{busy ? <Loader2 className="spin" /> : <VoteIcon />}{busy ? '正在投票…' : '确认投票'}</Button></form><p className="fine-print">每人一票，提交后不能更改。昵称可通过页面顶部的用户名按钮修改。</p></>
      : <><div className={`draw-number ${busy ? 'drawing' : ''}`}>{busy ? displayNumber : <Dice5 />}</div><h2>轮到你的好运了</h2><p>抽到几号，就给几号餐馆投一票。</p><form id="room-vote-form" onSubmit={vote}><label className="field">你的群昵称<Input required maxLength={24} value={room.preferred_nickname||nickname} readOnly={!!room.preferred_nickname} onChange={e => setNickname(e.target.value)} placeholder="让朋友知道你来啦" disabled={busy} /></label><Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Dice5 />}{busy ? '正在抽签…' : '随机抽签并投票'}</Button></form><p className="fine-print">同一浏览器每轮限投一次，昵称可通过页面顶部的用户名按钮修改。</p></>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    {results}</div>}
    {closed && <details className="past-votes"><summary>查看最终票数 · {room.total} 人已投</summary>{results}</details>}{participants}
    <section className="meal-members"><div className="section-heading"><h2>本轮成员</h2><span className="count"><Users size={17}/>{room.members.length} 人</span></div><p className="fine-print">发起、投票、登记或认领带饭的人会显示在这里。</p><MemberList members={room.members}/></section>
    {!closed && <div className="mobile-action-bar" data-hidden={share||confirm}><span>{room.total} 人已投</span>{room.myVote ? <Button className="primary" disabled={busy||!room.total} onClick={()=>setConfirm(true)}>确定餐馆</Button> : <Button className="primary" type="submit" form="room-vote-form" disabled={busy||manual&&!candidateId}>{busy?'正在提交…':manual?'确认投票':'抽签并投票'}</Button>}</div>}
    <Dialog open={share} onOpenChange={setShare}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>叫上群里的饭搭子</DialogTitle><DialogDescription>复制链接，粘贴到微信群。朋友打开就能参与本轮。</DialogDescription></DialogHeader><Input aria-label="本轮投票链接" readOnly ref={linkRef} value={typeof window !== 'undefined' ? window.location.href : ''} onFocus={e => e.target.select()} /><Button className="primary full" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { linkRef.current?.focus(); linkRef.current?.select(); setCopied(false); } }}>{copied ? <Check /> : <Copy />}{copied ? '已复制，去微信粘贴吧' : '复制投票链接'}</Button><p className="fine-print">也可以长按上面的链接复制。拥有链接的人可以参与并查看昵称与票数。</p></DialogContent></Dialog>
    <Dialog open={confirm&&!closed} onOpenChange={setConfirm}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>大家都投完了吗？</DialogTitle><DialogDescription>目前已有 {room.total} 人投票，请先确认大家已投完。确定后不再接收新票。最高票餐馆获胜，平票随机选一家。随后进入带饭阶段：全部带回，或确定餐馆满 12 小时后，饭局才结束。</DialogDescription></DialogHeader><Button className="primary full" disabled={busy||!room.total||closed} onClick={async () => { setBusy(true); setError(''); try { setRoom(await api<Room>({ action: 'close', room: room.id })); setConfirm(false); } catch (e) { setError((e as Error).message); setConfirm(false); } finally { setBusy(false); } }}>{busy ? '正在决定…' : '确定餐馆，进入带饭'}</Button></DialogContent></Dialog>
  </>;
}
export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [room, setRoom] = useState<Room | null>(null);
  const [roomId, setRoomId] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [catalogSyncError, setCatalogSyncError] = useState(false);
  const [editor, setEditor] = useState<Partial<Restaurant> | null>(null), [creating, setCreating] = useState(false), [title, setTitle] = useState('这顿吃什么？'), [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Restaurant | null>(null), [lastDeleted, setLastDeleted] = useState<Restaurant | null>(null), [deleteError, setDeleteError] = useState('');
  const [search,setSearch]=useState(''),[onlySelected,setOnlySelected]=useState(false);
  const [focusMenu,setFocusMenu]=useState(false);
  const [creatorNickname,setCreatorNickname]=useState('');
  const [mode, setMode] = useState<VotingMode>('random');
  const [deadlineInput,setDeadlineInput]=useState('');
  const [pendingCreation,setPendingCreation] = useState(false);
  const [pendingCreationCount,setPendingCreationCount] = useState(0);
  const [loadError,setLoadError] = useState('');
  const createRunning = useRef(false);
  const createAttempt = useRef<{requestId:string;title:string;mode:VotingMode;restaurantIds:string[];votingDeadlineAt?:string|null}|null>(null);
  useEffect(()=>{
    try {
      const saved=JSON.parse(sessionStorage.getItem('fd_pending_create')||'null');
      if(saved && typeof saved.requestId==='string' && /^[a-f0-9-]{36}$/.test(saved.requestId) && typeof saved.title==='string' && ['random','manual'].includes(saved.mode) && Array.isArray(saved.restaurantIds) && saved.restaurantIds.every((id:unknown)=>typeof id==='string')) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate a pending submission from browser storage after SSR.
        createAttempt.current=saved;setPendingCreationCount(saved.restaurantIds.length);setTitle(saved.title);setMode(saved.mode);if(saved.votingDeadlineAt)setDeadlineInput(champaignInput(new Date(saved.votingDeadlineAt)));setPendingCreation(true);
      }
    } catch {}
  },[]);
  const catalogEpoch = useRef(0);
  const loadSequence = useRef(0);
  const pageLoading = useRef(true);
  const currentRoom = useRef('');
  const unavailableRoom = useRef('');
  const acceptRoom = useCallback((incoming: Room) => {
    if (incoming.id !== currentRoom.current || incoming.id === unavailableRoom.current) return;
    setRoom(previous => {
      if(previous?.id===incoming.id&&previous.revision>incoming.revision)return previous;
      const profile=previous?.id===incoming.id&&previous.profile.revision>incoming.profile.revision?previous.profile:incoming.profile;
      return {...incoming,profile,preferred_nickname:profile.nickname};
    });
  }, []);
  const acceptCatalog = useCallback((incoming: Catalog) => {
    setCatalog(previous => ({ ...incoming, profile:previous&&previous.profile.revision>incoming.profile.revision?previous.profile:incoming.profile,restaurants: incoming.restaurants.map(r => ({ ...r, selected: previous?.restaurants.find(p => p.id === r.id)?.selected ?? r.selected })) }));
  }, []);
  const catalogChanged = useCallback((incoming: Catalog) => { catalogEpoch.current++; acceptCatalog(incoming); }, [acceptCatalog]);
  const load = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    pageLoading.current = true;
    const epoch = ++catalogEpoch.current;
    currentRoom.current = id; setRoomId(id); setRoom(null); setLoading(true); setLoadError(''); setError('');
    try { if (id) { const r = await api<Room>(undefined, id); if (currentRoom.current === id && sequence === loadSequence.current) { unavailableRoom.current = ''; acceptRoom(r); } } else { const c = await api<Catalog>(); if (!currentRoom.current && sequence === loadSequence.current && epoch === catalogEpoch.current) { acceptCatalog(c); setCatalogSyncError(false); setRoom(null); } } }
    catch (e) { if (currentRoom.current === id && sequence === loadSequence.current && epoch === catalogEpoch.current) { if (id && e instanceof ApiError && e.status === 404) { unavailableRoom.current = id; setRoom(null); } setLoadError((e as Error).message); } }
    finally { if (sequence === loadSequence.current) { pageLoading.current = false; setLoading(false); } }
  }, [acceptRoom, acceptCatalog]);
  useEffect(() => { const update = () => load(new URLSearchParams(window.location.search).get('room') || ''); update(); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, [load]);
  useEffect(() => { if (!roomId) return; let cancelled = false; let running = false; const timer = window.setInterval(async () => { if (running || document.hidden) return; running = true; try { const r = await api<Room>(undefined, roomId); if (!cancelled) { unavailableRoom.current = ''; acceptRoom(r); setError(''); setLoadError(''); } } catch (e) { if (!cancelled) { if (e instanceof ApiError && e.status === 404) { unavailableRoom.current = roomId; setRoom(null); setError(e.message); } else setError('连接暂时中断，正在自动重连。'); } } finally { running = false; } }, 4000); return () => { cancelled = true; clearInterval(timer); }; }, [roomId, acceptRoom]);
  useEffect(() => {
    if (roomId) return;
    let cancelled = false, running = false;
    const refresh = async () => {
      if (document.hidden || currentRoom.current || pageLoading.current || running) return;
      running = true;
      const epoch = ++catalogEpoch.current;
      try {
        const c = await api<Catalog>();
        if (!cancelled && !currentRoom.current && epoch === catalogEpoch.current) { acceptCatalog(c); setCatalogSyncError(false); setLoadError(''); }
      } catch { if (!cancelled && !currentRoom.current && epoch === catalogEpoch.current) setCatalogSyncError(true); }
      finally { running = false; }
    };
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [roomId, acceptCatalog]);
  function navigate(id = '') { window.history.pushState({}, '', id ? `/?room=${id}` : '/'); load(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function clearCreateAttempt() {
    createAttempt.current=null;setPendingCreation(false);
    try { sessionStorage.removeItem('fd_pending_create'); } catch {}
  }
  async function createRoom() {
    if(createRunning.current) return;
    createRunning.current=true;setBusy(true);setError('');
    if(!createAttempt.current){
      try{const deadline=deadlineFromChampaign(deadlineInput);if(deadline&&Date.parse(deadline)<=Date.now())throw new Error('请选择未来的截止时间。');createAttempt.current={requestId:crypto.randomUUID(),title,mode,restaurantIds:catalog?.restaurants.filter(r=>r.selected).map(r=>r.id)||[],...(deadline?{votingDeadlineAt:deadline}:{})};}
      catch(e){setError((e as Error).message);createRunning.current=false;setBusy(false);return;}
    }
    setPendingCreationCount(createAttempt.current.restaurantIds.length);
    try { sessionStorage.setItem('fd_pending_create',JSON.stringify(createAttempt.current)); } catch {}
    try {
      if(!catalog?.profile.nickname){
        const p=await api<Profile>({action:'saveProfile',nickname:creatorNickname,expectedRevision:catalog?.profile.revision||0});
        setCatalog(previous=>previous?{...previous,profile:p}:previous);
      }
      const r=await api<Room>({action:'create',...createAttempt.current});
      clearCreateAttempt();setCreating(false);window.history.pushState({},'',`/?room=${r.id}`);currentRoom.current=r.id;setRoomId(r.id);acceptRoom(r);window.scrollTo({top:0});
    } catch(e) {
      if(e instanceof ApiError && e.status<500) { clearCreateAttempt();setError(e.message); }
      else { setPendingCreation(true);setError('暂时没收到创建结果，请重试。已保留本次填写内容，不会重复创建饭局。'); }
    } finally { createRunning.current=false;setBusy(false); }
  }
  async function profileSaved(profile:Profile) {
    catalogEpoch.current++;
    setCatalog(previous=>previous?{...previous,profile}:previous);
    setRoom(previous=>previous?{...previous,profile,preferred_nickname:profile.nickname}:previous);
    try {
      const id=currentRoom.current;
      if(id) acceptRoom(await api<Room>(undefined,id));
      else catalogChanged(await api<Catalog>());
    } catch { throw new Error('用户名已保存，列表暂未刷新，请稍后重试或刷新页面。'); }
  }
  const query=search.normalize('NFKC').trim().toLocaleLowerCase();
  const visibleRestaurants=catalog?.restaurants.filter(r=>(!onlySelected||!!r.selected)&&(!query||`${r.name} ${r.cuisine} ${r.address}`.normalize('NFKC').toLocaleLowerCase().includes(query)))||[];
  function applyPool(ids:string[]){setCatalog(previous=>previous&&({...previous,restaurants:previous.restaurants.map(r=>({...r,selected:ids.includes(r.id)?1:0}))}));}
  const selected = catalog?.restaurants.filter(r => r.selected).length || 0;
  return <div className="app-shell"><header className="site-header"><a href="/" className="brand" onClick={e => { e.preventDefault(); navigate(); }}><Soup aria-hidden="true" /><span>饭点</span></a><span className="location">Champaign · Urbana</span><nav className="site-nav" aria-label="主导航"><a className="nav-link active" href={roomId ? '/' : '#restaurants'} onClick={e => { if (roomId) { e.preventDefault(); navigate(); } }}>餐馆清单</a><a className="nav-link" href="/history">历史记录</a></nav><UserProfile profile={roomId?room?.profile:catalog?.profile} members={roomId?room?.members:undefined} onSaved={profileSaved}/></header>
    <main className={room && room.phase!=='finished' ? 'has-mobile-action' : ''}><PersonalUpdates items={(roomId?room?.notifications:catalog?.notifications)||[]} open={navigate}/>{(error||loadError) && <div className="error page-error" role="alert">{error||loadError}<Button variant="ghost" onClick={() => load(roomId)}>重试</Button></div>}
      {loading ? <div className="loading"><Loader2 className="spin" /><p>正在准备餐桌…</p></div> : roomId ? room && room.id === roomId && <RoomView key={room.id} room={room} setRoom={acceptRoom} home={() => navigate()} /> : catalog && <>
        {catalogSyncError && <p className="home-sync-error" role="status">带饭状态暂未更新，正在自动重连。恢复连接后会自动更新。</p>}
        <section className="intro"><div className="intro-copy"><h1>今天吃什么？</h1><p>自己投票，或随机抽签，<br className="mobile-break" />一起选出这顿想吃的餐馆。</p></div><FoodArt /><div className="intro-action"><Button className="primary" disabled={(!pendingCreation && selected < 2) || busy} onClick={() => { setError(''); setCreating(true); }}>{pendingCreation?'继续上次创建':'创建一轮投票'} <ArrowRight /></Button><span>{selected >= 2 ? '建好后，把链接发到微信群' : '请先选中至少两家餐馆'}</span></div></section>
        {!!catalog.activeRooms.length && <section className="active-meals"><div className="section-heading"><div><h2>正在进行的饭局</h2><p>我发起和参与的 · {catalog.activeRoomCount} 局进行中</p><p className="home-sync-note">带饭状态每 8 秒自动更新</p></div><a className="history-open" href="/history">全部记录<ArrowRight size={16}/></a></div><div className="active-meal-list">{catalog.activeRooms.map(r => <HomeMealCard key={r.id} meal={r} open={navigate}/>)}</div>{catalog.activeRoomCount>catalog.activeRooms.length&&<a href="/history" className="history-open">还有 {catalog.activeRoomCount-catalog.activeRooms.length} 局，查看全部记录</a>}</section>}
        <section id="restaurants" className="catalog"><div className="section-heading"><div><h2>餐馆清单</h2><p>共享餐馆库 · 本轮已选 {selected} 家</p></div><Button variant="outline" className="secondary" onClick={() => {setFocusMenu(false);setEditor({});}}><Plus />添加餐馆</Button></div>
          <RestaurantPools catalog={catalog} apply={applyPool} saved={catalogChanged} disabled={busy||pendingCreation}/>
          <div className="catalog-tools"><label className="catalog-search"><span>搜索餐馆</span><Input type="search" aria-label="搜索餐馆名称、类型或地址" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索店名、类型或地址"/></label><label className="selected-filter"><Checkbox checked={onlySelected} onCheckedChange={value=>setOnlySelected(!!value)}/>只看已选（{selected}）</label><div className="catalog-selection-actions"><Button variant="outline" disabled={busy||pendingCreation||!visibleRestaurants.length} onClick={()=>applyPool([...new Set([...(catalog.restaurants.filter(r=>r.selected).map(r=>r.id)),...visibleRestaurants.map(r=>r.id)])])}>全选当前结果</Button><Button variant="ghost" disabled={busy||pendingCreation||!selected} onClick={()=>applyPool([])}>清空已选</Button><span role="status">显示 {visibleRestaurants.length} / {catalog.restaurants.length} 家</span></div></div>
          {!!catalog.restaurants.length&&!visibleRestaurants.length&&<p className="catalog-empty">没有符合条件的餐馆。试试清除搜索或关闭「只看已选」。</p>}
          {lastDeleted && <div className="delete-notice" role="status"><span>已删除「{lastDeleted.name}」</span><Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const restored = await api<Catalog>({ action: 'restoreRestaurant', id: lastDeleted.id }); catalogChanged({ ...restored, restaurants: restored.restaurants.map(r => r.id === lastDeleted.id ? { ...r, selected: lastDeleted.selected } : r) }); setLastDeleted(null); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }}><Undo2 />撤销</Button></div>}
          {!catalog.restaurants.length && <p className="catalog-empty">还没有餐馆，点击「添加餐馆」开始吧。</p>}
          <div className="restaurant-list">{visibleRestaurants.map(r => <div className={`restaurant-row ${!r.selected ? 'excluded' : ''}`} key={r.id}><Checkbox aria-label={`选择 ${r.name}`} checked={!!r.selected} disabled={busy||pendingCreation} onCheckedChange={checked => setCatalog(previous => previous && ({ ...previous, restaurants: previous.restaurants.map(item => item.id === r.id ? { ...item, selected: checked ? 1 : 0 } : item) }))} /><span className="row-number">{String(catalog.restaurants.findIndex(item=>item.id===r.id) + 1).padStart(2, '0')}</span><div className="restaurant-info"><strong>{r.name}</strong><span>{r.cuisine || '自定义餐馆'}</span><RestaurantLinks restaurant={r} onAddMenu={()=>{setFocusMenu(true);setEditor(r);}}/></div><div className="restaurant-address">{r.address || '可以补充你们熟悉的店名和地址'}</div><Button variant="ghost" size="icon" className="icon-button" aria-label={`修改 ${r.name}`} onClick={() => {setFocusMenu(false);setEditor(r);}}><Pencil size={17} /></Button><Button variant="ghost" className="restaurant-delete" aria-label={`删除 ${r.name}`} disabled={busy} onClick={() => { setDeleteError(''); setDeleting(r); }}><Trash2 size={16} /><span>删除</span></Button></div>)}</div>
          <p className="catalog-note">人人都能添加、改名和删除；勾选只影响你创建的下一轮。已开始的投票名单保持不变。</p>
        </section>
        {!!catalog.recentFinishedRooms.length && <section className="active-meals recent-finished-meals"><div className="section-heading"><div><h2>最近结束的带饭</h2><p>最近 24 小时 · 最多展示 4 局</p></div><a className="history-open" href="/history">全部记录<ArrowRight size={16}/></a></div><div className="active-meal-list">{catalog.recentFinishedRooms.map(r => <HomeMealCard key={r.id} meal={r} open={navigate}/>)}</div></section>}
        {!!catalog.rooms.length && <section className="recent"><div className="recent-heading"><h2>我发起的投票</h2><a href="/history">查看全部历史<ArrowRight size={16} /></a></div><p className="history-timezone">按发起时间排列 · 香槟当地时间</p>{catalog.rooms.map(r => <button key={r.id} onClick={() => navigate(r.id)}><span className="recent-meal-main"><strong>{r.title}</strong><time dateTime={r.created_at}>{formatMealDateTime(r.created_at)}</time></span><span><MealStatus meal={r} /><ArrowRight size={17} /></span></button>)}</section>}
      </>}
    </main><footer><span>饭点 · 和饭搭子一起，少纠结一顿。</span><span>自主投票 · 随机抽签</span></footer>
    {editor && <RestaurantEditor item={editor} focusMenu={focusMenu} close={() => setEditor(null)} saved={catalogChanged} />}
    <AlertDialog open={!!deleting} onOpenChange={open => !open && !busy && setDeleting(null)}><AlertDialogContent className="editor-dialog"><AlertDialogHeader><AlertDialogTitle>删除这家餐馆？</AlertDialogTitle><AlertDialogDescription>「{deleting?.name}」会从大家共用的餐馆库中移除，之后的新投票不再可选。已开始的投票、结果和带饭记录不受影响。删除后可点击「撤销」恢复。</AlertDialogDescription></AlertDialogHeader>{deleteError && <p className="error" role="alert">{deleteError}</p>}<AlertDialogFooter><AlertDialogCancel className="secondary" disabled={busy}>取消</AlertDialogCancel><AlertDialogAction className="delete-confirm" variant="destructive" disabled={busy} onClick={async e => { e.preventDefault(); if(!deleting) return; setBusy(true); setDeleteError(''); try { catalogChanged(await api<Catalog>({ action:'deleteRestaurant', id:deleting.id })); setLastDeleted(deleting); setDeleting(null); } catch(e) { setDeleteError((e as Error).message); } finally { setBusy(false); } }}>{busy ? '正在删除…' : '确认删除'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={creating} onOpenChange={open => !busy && setCreating(open)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>今天这顿，你来组局</DialogTitle><DialogDescription>本轮包含已选的 {pendingCreation ? pendingCreationCount : selected} 家餐馆。{mode === 'manual' ? '每人自主选择一家餐馆投票。' : '每人随机抽一家餐馆并自动投票。'}</DialogDescription></DialogHeader><form onSubmit={e => { e.preventDefault(); void createRoom(); }}>{catalog?.profile.nickname?<p className="create-identity">发起人：<strong>{catalog.profile.nickname}</strong></p>:<label className="field">你的群昵称<Input required maxLength={24} disabled={busy} value={creatorNickname} onChange={e=>setCreatorNickname(e.target.value)} placeholder="让大家知道是谁发起的"/></label>}<label className="field">这轮投票的名字<Input disabled={busy||pendingCreation} required maxLength={60} value={title} onChange={e => setTitle(e.target.value)} /></label><fieldset className="mode-field" disabled={busy||pendingCreation}><legend>选择本轮玩法</legend><div className="mode-options"><label className={`mode-option ${mode === 'manual' ? 'chosen' : ''}`}><input type="radio" name="voting-mode" value="manual" checked={mode === 'manual'} onChange={() => setMode('manual')} /><VoteIcon aria-hidden="true" /><span><strong>自主投票</strong><small>每人自己选一家想吃的餐馆</small></span></label><label className={`mode-option ${mode === 'random' ? 'chosen' : ''}`}><input type="radio" name="voting-mode" value="random" checked={mode === 'random'} onChange={() => setMode('random')} /><Dice5 aria-hidden="true" /><span><strong>随机抽签</strong><small>每人随机抽一家，自动计一票</small></span></label></div><p className="fine-print">两种玩法均为一人一票，最高票获胜；平票时随机选一家。创建后玩法固定。</p></fieldset><label className="field">投票截止时间 <span>选填，香槟当地时间</span><Input type="datetime-local" disabled={busy||pendingCreation} value={deadlineInput} onChange={e=>setDeadlineInput(e.target.value)}/></label><div className="deadline-presets"><Button type="button" variant="ghost" disabled={busy||pendingCreation} onClick={()=>setDeadlineInput(champaignInput(new Date(Date.now()+30*60000)))}>30 分钟后</Button><Button type="button" variant="ghost" disabled={busy||pendingCreation} onClick={()=>setDeadlineInput(champaignInput(new Date(Date.now()+60*60000)))}>1 小时后</Button><Button type="button" variant="ghost" disabled={busy||pendingCreation} onClick={()=>setDeadlineInput('')}>不设截止</Button></div><p className="fine-print">到点按最高票自动确定，平票随机选择；无人投票则结束并显示未产生结果。也可以由任何人提前结束。</p>{error && <p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />}{busy ? '正在创建…' : pendingCreation ? '重试，找回上次创建的饭局' : '创建投票，叫上大家'}</Button><p className="fine-print">任何持有本轮链接的人都可以结束投票。请保留此浏览器，方便从历史记录管理你发起的饭局。</p></form></DialogContent></Dialog>
  </div>;
}
