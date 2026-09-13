const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function champaignInput(value:Date) {
  const parts=formatter.formatToParts(value),p=(type:string)=>parts.find(p=>p.type===type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
// Match the named timezone instead of using the browser's timezone or a fixed DST offset.
export function deadlineFromChampaign(value:string):string|null {
  if(!value)return null;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('请填写完整的香槟日期与时间。');
  const naive=Date.parse(value+'Z');
  const matches=[5,6].map(hours=>new Date(naive+hours*3600000)).filter(date=>!Number.isNaN(date.getTime())&&champaignInput(date)===value);
  if(matches.length!==1)throw new Error('这个时间在夏令时切换中不存在或出现两次，请选择其他时间。');
  return matches[0].toISOString();
}
export function votingDeadline(value:unknown) {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('投票截止时间无效。');
  return value;
}
export const OPEN_VOTING_SQL="status='open' AND deleted_at IS NULL AND (voting_deadline_at IS NULL OR voting_deadline_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
export function settleVoting(db:D1Database,where:string,values:string[]) {
  return db.prepare(`UPDATE rooms SET status='closed',revision=revision+1,
    winner_id=CASE WHEN EXISTS(SELECT 1 FROM votes WHERE room_id=rooms.id) THEN
      (SELECT c.id FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id AND v.room_id=c.room_id WHERE c.room_id=rooms.id GROUP BY c.id ORDER BY COUNT(v.id) DESC,random() LIMIT 1) ELSE NULL END,
    decided_at=CASE WHEN EXISTS(SELECT 1 FROM votes WHERE room_id=rooms.id) THEN voting_deadline_at ELSE NULL END,
    completed_at=CASE WHEN EXISTS(SELECT 1 FROM votes WHERE room_id=rooms.id) THEN NULL ELSE voting_deadline_at END,
    completion_reason=CASE WHEN EXISTS(SELECT 1 FROM votes WHERE room_id=rooms.id) THEN NULL ELSE 'no_votes' END
    WHERE status='open' AND deleted_at IS NULL AND voting_deadline_at IS NOT NULL AND voting_deadline_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${where})`).bind(...values);
}
