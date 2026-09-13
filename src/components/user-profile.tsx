'use client';
import { useState } from 'react';
import { Check, Pencil, UserRound, Users } from 'lucide-react';
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
  async function save(e:React.FormEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try {
      const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveProfile',nickname:draft,expectedRevision:revision})});
      const value=await response.json() as Profile & {error?:string};
      if(!response.ok)throw new Error(value.error||'暂时无法保存，请重试。');
      setDraft(value.nickname);setRevision(value.revision);
      await onSaved(value);setOpen(false);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Button variant="outline" className="username-button" disabled={!profile} aria-label={`用户名：${profile?.nickname||'未设置'}，查看或修改`} onClick={()=>{setDraft(profile?.nickname||'');setRevision(profile?.revision||0);setError('');setOpen(true);}}><UserRound/><span>{profile?.nickname||'设置用户名'}</span><Pencil className="username-pencil"/></Button>
    <Dialog open={open} onOpenChange={value=>!busy&&setOpen(value)}><DialogContent className="editor-dialog profile-dialog"><DialogHeader><DialogTitle>我的用户名</DialogTitle><DialogDescription>现在使用的是你在此浏览器保存的身份。大家会在饭局和带饭清单中看到这个昵称。</DialogDescription></DialogHeader>
      <form onSubmit={save}><label className="field">群昵称<Input autoFocus required maxLength={24} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="用群友认得的名字"/></label>
        <p className="fine-print">修改后，你发起的饭局、已投的票、带饭登记和认领中的昵称会一起更新。票数、菜品和认领关系保留。</p>
        {error&&<div><p className="error" role="alert">{error}</p><Button type="button" variant="ghost" disabled={busy} onClick={async()=>{
          setBusy(true);try{const response=await fetch('/api/game?profile=1',{cache:'no-store'});if(!response.ok)throw new Error('暂时无法读取，请稍后重试。');const latest=await response.json() as Profile;setDraft(latest.nickname);setRevision(latest.revision);await onSaved(latest);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
        }}>读取最新用户名</Button></div>}<Button className="primary full" disabled={busy}><Check/>{busy?'正在保存…':'保存用户名'}</Button>
      </form>
      {members&&<section className="profile-members"><h3><Users size={18}/>本轮成员 · {members.length} 人</h3><MemberList members={members}/></section>}
      <p className="fine-print">请继续使用同一浏览器；更换设备或清除浏览器数据后，不能仅凭昵称找回身份。</p>
    </DialogContent></Dialog>
  </>;
}
