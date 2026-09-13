'use client';
import { gameFetch } from '@/lib/game-client';
import { useState } from 'react';
import { Check, Pencil, UserRound, Users, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Member, Profile } from '@/lib/types';

export function MemberList({ members }: { members: Member[] }) {
  return <div className="member-list">{members.map((member,i)=><div className="member-row" key={i}>
    <span className="avatar" aria-hidden="true">{Array.from(member.nickname)[0]}</span>
    <div><strong>{member.nickname}{member.isMe&&<span className="mine-label">我</span>}</strong><div className="member-roles">
      {member.isHost&&<span className="member-host">发起人</span>}
      {member.hasVoted&&<span>已投票</span>}
      {!!member.requests&&<span>登记带饭 {member.requests} 条</span>}
      {!!member.carrying&&<span>正在带 {member.carrying} 条</span>}
      {!!member.delivered&&<span>已带回 {member.delivered} 条</span>}
    </div></div>
  </div>)}</div>;
}
export function UserProfile({ profile, members, onSaved }: { profile?: Profile; members?: Member[]; onSaved: (profile: Profile) => Promise<void> }) {
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(''),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const signedIn=!!profile?.account?.signed_in;
  async function save(e:React.FormEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const response=await gameFetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveProfile',nickname:draft,expectedRevision:revision})});
      const value=await response.json() as Profile & {error?:string};
      if(!response.ok)throw new Error(value.error||'暂时无法保存，请重试。');
      setDraft(value.nickname);setRevision(value.revision);
      await onSaved(value);setOpen(false);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Button variant="outline" className="username-button" disabled={!profile} aria-label={`用户名：${profile?.nickname||'未设置'}，查看或修改`} onClick={()=>{setDraft(profile?.nickname||'');setRevision(profile?.revision||0);setError('');setOpen(true);}}><UserRound/><span>{profile?.nickname||'登录 / 设置昵称'}</span><Pencil className="username-pencil"/></Button>
    <Dialog open={open} onOpenChange={value=>!busy&&setOpen(value)}><DialogContent className="editor-dialog profile-dialog"><DialogHeader><DialogTitle>昵称与登录</DialogTitle><DialogDescription>{signedIn?"昵称和饭局记录已保存到账号，下次登录会自动找回。":"设置一次昵称，此浏览器下次会自动使用。登录账号还能在其他设备找回记录。"}</DialogDescription></DialogHeader>
      {(profile?.sign_in_path||signedIn)&&<section className={`account-status ${signedIn?'account-connected':''}`}>
        <div><strong>{signedIn?'已登录 · 自动记住':'跨设备保留昵称与历史'}</strong><p>{signedIn?profile?.account?.email:'使用同一个 ChatGPT 账号登录，手机和电脑都能继续。首次登录会保留此浏览器已有的饭局。'}</p></div>
        {signedIn?<a href={profile?.sign_out_path} target="_top" className="account-link"><LogOut size={17}/>退出登录</a>:<a href={profile?.sign_in_path} target="_top" className="account-link account-login"><LogIn size={18}/>通过 ChatGPT 登录</a>}
      </section>}
      <form onSubmit={save}><label className="field">群昵称<Input autoFocus required maxLength={24} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="用群友认得的名字"/></label>
        <p className="fine-print">修改后，你发起的饭局、已投的票、带饭登记和认领中的昵称会一起更新。票数、菜品和认领关系保留。</p>
        {error&&<div><p className="error" role="alert">{error}</p><Button type="button" variant="ghost" disabled={busy} onClick={async()=>{
          setBusy(true);try{const response=await gameFetch('/api/game?profile=1',{cache:'no-store'});if(!response.ok)throw new Error('暂时无法读取，请稍后重试。');const latest=await response.json() as Profile;setDraft(latest.nickname);setRevision(latest.revision);await onSaved(latest);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
        }}>读取最新用户名</Button></div>}<Button className="primary full" disabled={busy}><Check/>{busy?'正在保存…':'保存昵称，以后自动使用'}</Button>
      </form>
      {members&&<section className="profile-members"><h3><Users size={18}/>本轮成员 · {members.length} 人</h3><MemberList members={members}/></section>}
      <p className="fine-print">{signedIn?"群友只会看到你的群昵称，不会看到登录邮箱。":"不登录也能使用；若清除浏览器数据或更换设备，需要登录账号才能找回已同步的信息。"}</p>
    </DialogContent></Dialog>
  </>;
}
