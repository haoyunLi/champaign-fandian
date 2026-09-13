import type {Notice} from './types';
export async function notifications(db:D1Database,owner:string):Promise<Notice[]> {
  await db.prepare('DELETE FROM notifications WHERE owner=? AND id < COALESCE((SELECT id FROM notifications WHERE owner=? ORDER BY id DESC LIMIT 1 OFFSET 99),0)').bind(owner,owner).run();
  return (await db.prepare(`SELECT n.id,n.room_id,n.message,n.created_at FROM notifications n JOIN rooms r ON r.id=n.room_id
    WHERE n.owner=? AND n.read_at IS NULL AND r.deleted_at IS NULL ORDER BY n.id DESC LIMIT 20`).bind(owner).all<Notice>()).results;
}
