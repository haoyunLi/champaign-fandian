'use client';
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import type { PickupPlan, Room } from '@/lib/types';
export function PickupPlanEditor({room,busy,save,error}: {room:Room;busy:boolean;error:string;save:(payload:Record<string,unknown>)=>Promise<boolean>}) {
  const [editing,setEditing]=useState<PickupPlan|null>(null);
  const changed=!!editing&&editing.revision!==room.myPickupPlan.revision;
  return <div className="pickup-plan-panel"><div><strong><MapPin size={17}/>我的取餐安排</strong><p>{room.myPickupPlan.time?`预计 ${room.myPickupPlan.time}（香槟时间）`:'预计带回时间待填写'} · {room.myPickupPlan.place||'取餐地点待填写'}</p><p>显示在你认领的每条登记旁，收餐人可直接查看。</p></div><Button variant="outline" disabled={busy} onClick={()=>setEditing({...room.myPickupPlan})}>填写 / 修改</Button>
    <Dialog open={!!editing} onOpenChange={open=>!open&&!busy&&setEditing(null)}><DialogContent className="editor-dialog"><DialogHeader><DialogTitle>告诉大家什么时候、在哪里取餐</DialogTitle><DialogDescription>只更新你在本轮的取餐安排；饭局原来的结束时间不变。</DialogDescription></DialogHeader>
      <form onSubmit={async e=>{e.preventDefault();if(!editing||changed||!room.canEditPickupPlan)return;if(await save({action:'savePickupPlan',...editing,expectedRevision:editing.revision}))setEditing(null);}}>
        <label className="field">预计带回时间（香槟时间）<Input maxLength={60} disabled={busy} value={editing?.time||''} onChange={e=>setEditing(p=>p&&({...p,time:e.target.value}))} placeholder="例如：今天 18:30 左右"/></label>
        <label className="field">取餐地点<Input maxLength={120} disabled={busy} value={editing?.place||''} onChange={e=>setEditing(p=>p&&({...p,place:e.target.value}))} placeholder="例如：宿舍一楼大厅"/></label>
        {changed&&<p className="error" role="alert">安排已在其他页面修改。<Button type="button" variant="ghost" onClick={()=>setEditing({...room.myPickupPlan})}>读取最新安排</Button></p>}
        {!room.canEditPickupPlan&&<p className="error">你已没有待带回的认领，无法再修改。</p>}
        {error&&<p className="error" role="alert">{error}</p>}<Button className="primary full" disabled={busy||changed||!room.canEditPickupPlan}>保存取餐安排</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}
