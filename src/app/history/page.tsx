'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, History, Loader2, RotateCcw, Soup, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { HistoryPage, HistoryRoom, Profile } from '@/lib/types';
import { UserProfile } from '@/components/user-profile';
import { ReplayButton } from '@/components/replay-button';
import { MealStatus } from '@/components/meal-status';
import { formatMealDateTime } from '@/lib/meal-date';

async function request<T>(url: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || '暂时无法完成，请重试。');
  return value;
}

export default function HistoryView() {
  const [profile,setProfile]=useState<Profile>();
  const [view, setView] = useState<'all' | 'hosted' | 'joined' | 'trash'>('all');
  const trash=view==='trash';
  const [rows, setRows] = useState<HistoryRoom[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState<HistoryRoom | null>(null);
  const [lastDeleted, setLastDeleted] = useState<HistoryRoom | null>(null);
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);

  const load = useCallback(async (next?: string) => {
    const version = ++epoch.current;
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ history: trash ? 'trash' : 'active', scope: trash ? 'all' : view });
      if (next) query.set('cursor', next);
      const page = await request<HistoryPage>(`/api/game?${query}`);
      if (epoch.current !== version) return;
      setRows(previous => next ? [...previous, ...page.rooms.filter(r => !previous.some(p => p.id === r.id))] : page.rooms);
      setCursor(page.nextCursor);setProfile(previous=>previous&&previous.revision>page.profile.revision?previous:page.profile);
    } catch (e) { if (epoch.current === version) setError((e as Error).message); }
    finally { if (epoch.current === version) setLoading(false); }
  }, [trash,view]);

  useEffect(() => {
    const invalidate=()=>{epoch.current++;};
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starting the external request also resets its loading indicator.
    void load(); return invalidate;
  }, [load]);

  function switchTab(value: typeof view) {
    if (busy || value === view) return;
    epoch.current++; setRows([]); setCursor(null); setLoading(true); setError(''); setNotice(''); setView(value);
  }

  async function restore(item: HistoryRoom) {
    if (busy) return;
    setBusy(true); setError(''); epoch.current++;
    try {
      await request('/api/game', { action: item.isHost ? 'restoreRoom' : 'restoreHistory', room: item.id });
      if (trash) setRows(previous => previous.filter(r => r.id !== item.id));
      setLastDeleted(previous => previous?.id === item.id ? null : previous);
      setNotice(`已恢复「${item.title}」，可在「全部」中查看。`);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <header className="site-header">
      <a href="/" className="brand"><Soup aria-hidden="true" /><span>饭点</span></a>
      <span className="location">Champaign · Urbana</span>
      <nav className="site-nav" aria-label="主导航"><a className="nav-link" href="/">餐馆清单</a><a className="nav-link active" href="/history" aria-current="page">历史记录</a></nav>
      <UserProfile profile={profile} onSaved={async value=>{setProfile(value);await load();}}/>
    </header>
    <main className="history-page">
      <a className="history-back" href="/"><ArrowLeft size={16} />回到餐馆清单</a>
      <div className="history-heading"><div><h1>每一顿，都有记录</h1><p>自己发起的、别人发起而你参与的，都能在这里找回。</p></div><History aria-hidden="true" /></div>
      <p className="history-identity">请使用发起或参与时的同一浏览器查看记录；更换设备或清除浏览器数据后，无法找回原来的身份。</p>
      <div className="history-toolbar">
        <div className="history-tabs" aria-label="记录分类">
          <Button variant="ghost" aria-pressed={view==='all'} disabled={busy} onClick={() => switchTab('all')}>全部</Button>
          <Button variant="ghost" aria-pressed={view==='hosted'} disabled={busy} onClick={() => switchTab('hosted')}>我发起的</Button>
          <Button variant="ghost" aria-pressed={view==='joined'} disabled={busy} onClick={() => switchTab('joined')}>我参与的</Button>
          <Button variant="ghost" aria-pressed={trash} disabled={busy} onClick={() => switchTab('trash')}>回收站</Button>
        </div>
        <Button variant="ghost" className="history-refresh" disabled={busy || loading} onClick={() => void load()}><RotateCcw size={16} />刷新</Button>
      </div>
      <p className="history-tab-note">{trash ? '自己删除的投票、从个人列表移除的记录，都可在这里恢复。' : view==='hosted' ? '你发起的投票，包括正在进行和已经结束的记录。' : '投票、登记或认领带饭后自动收录；也可在群链接页面点「保存到历史」。按发起时间从新到旧排列。'}</p>
      <p className="history-timezone">日期和时间均为香槟当地时间。</p>
      {lastDeleted && <div className="delete-notice" role="status"><span>「{lastDeleted.title}」已移入回收站。</span><Button variant="ghost" disabled={busy || loading} onClick={() => void restore(lastDeleted)}><Undo2 />撤销</Button></div>}
      {notice && <p className="history-notice" role="status">{notice}</p>}
      {error && <div className="error" role="alert">{error}<Button variant="ghost" disabled={busy || loading} onClick={() => void load()}>重新加载</Button></div>}
      <div className="history-list" aria-busy={loading}>
        {rows.map(item => <article className="history-row" key={item.id}>
          <div className="history-info">
            <div className="history-title"><h2>{item.title}</h2><MealStatus meal={item} /></div>
            <p className="history-date"><CalendarDays size={17} aria-hidden="true"/><span>发起日期 <time dateTime={item.created_at}>{formatMealDateTime(item.created_at)}</time></span></p>
            {item.deleted_at && <p className="history-removed-date">{item.isHost ? '删除于' : '移除于'} <time dateTime={item.deleted_at}>{formatMealDateTime(item.deleted_at)}</time></p>}
            <p className="creator-line">{item.creator_name} 发起{item.isHost&&" · 我"}</p>
            <p className="history-result">{item.winner_name ? <>选定餐馆 <strong>{item.winner_name}</strong></> : '餐馆尚未确定'}</p>
            <p className="history-counts"><b className="history-role">{item.isHost ? '我发起的' : '参与或保存'}</b><span>·</span>{item.mode === 'manual' ? '自主投票' : '随机抽签'}<span>·</span>{item.vote_count} 人投票<span>·</span>{item.order_count} 条带饭登记</p>
          </div>
          <div className="history-actions">{trash ? <Button variant="outline" className="secondary" disabled={busy || loading} onClick={() => void restore(item)}><Undo2 />恢复记录</Button> : <>
            <a className="history-open" href={`/?room=${encodeURIComponent(item.id)}`}>查看详情<ArrowRight size={16} /></a>
            <ReplayButton roomId={item.id} />
            <Button variant="ghost" className="restaurant-delete" aria-label={`${item.isHost ? '删除投票' : '移除历史'} ${item.title}`} disabled={busy || loading} onClick={() => { setDeleteError(''); setDeleting(item); }}><Trash2 size={16} />{item.isHost ? '删除' : '移除'}</Button>
          </>}</div>
        </article>)}
      </div>
      {loading && <div className="history-loading" role="status"><Loader2 className="spin" size={20} />正在读取记录…</div>}
      {!loading && !error && !rows.length && <div className="history-empty"><History size={36} aria-hidden="true" /><h2>{trash ? '回收站是空的' : view==='hosted' ? '还没有你发起的投票' : view==='joined' ? '还没有参与或保存的投票' : '还没有饭局记录'}</h2><p>{trash ? '删除或移除的记录会出现在这里。' : view==='hosted' ? '创建第一轮投票，和饭搭子一起决定今天吃什么。' : '打开朋友分享的链接，投票、登记带饭，或点击「保存到历史」。'}</p>{!trash && <a href="/" className="history-open">去发起投票<ArrowRight size={16} /></a>}</div>}
      {cursor && !loading && <Button variant="outline" className="secondary history-more" disabled={busy} onClick={() => void load(cursor)}>加载更早的记录</Button>}
    </main>
    <footer><span>饭点 · 和饭搭子一起，少纠结一顿。</span><span>自主投票 · 随机抽签</span></footer>
    <AlertDialog open={!!deleting} onOpenChange={open => !open && !busy && setDeleting(null)}><AlertDialogContent className="editor-dialog">
      <AlertDialogHeader><AlertDialogTitle>{deleting?.isHost ? '删除这轮历史记录？' : '从我的历史中移除？'}</AlertDialogTitle><AlertDialogDescription>{deleting?.isHost ? `「${deleting.title}」的投票、结果和带饭清单会一起移入回收站。群里的原链接将暂时无法访问，也无法继续投票或登记带饭。你可以在回收站恢复整轮记录和链接。` : `「${deleting?.title}」仅从你的历史列表移除，原投票、票数、带饭清单和其他人的记录不受影响。你可以从回收站恢复。`}</AlertDialogDescription></AlertDialogHeader>
      {deleteError && <p className="error" role="alert">{deleteError}</p>}
      <AlertDialogFooter><AlertDialogCancel className="secondary" disabled={busy}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" className="delete-confirm" disabled={busy} onClick={async e => {
        e.preventDefault(); if (!deleting || busy) return;
        const item = deleting; setBusy(true); setDeleteError(''); epoch.current++;
        try {
          await request('/api/game', { action: item.isHost ? 'deleteRoom' : 'removeHistory', room: item.id });
          setRows(previous => previous.filter(r => r.id !== item.id)); setLastDeleted(item); setNotice(''); setDeleting(null);
          await load();
        } catch (e) { setDeleteError((e as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? '正在处理…' : deleting?.isHost ? '确认删除' : '仅移除我的记录'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
