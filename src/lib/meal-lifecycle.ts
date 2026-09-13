import type { MealLifecycle } from '@/lib/types';

// Older rooms have no confirmation timestamp. Give them one fixed rollout window,
// rather than guessing from creation time or restarting the clock on each visit.
const LEGACY_DELIVERY_START = '2026-09-12T06:42:54.000Z';
const ALL_DELIVERED = "EXISTS (SELECT 1 FROM orders WHERE room_id=rooms.id) AND NOT EXISTS (SELECT 1 FROM orders WHERE room_id=rooms.id AND status<>'delivered')";
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const DEADLINE_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ',decided_at,'+12 hours')";

// Each food write checks database execution time, even if a request waited past its deadline.
export const ACTIVE_DELIVERY_SQL = `deleted_at IS NULL AND status='closed' AND completed_at IS NULL AND decided_at IS NOT NULL AND ${DEADLINE_SQL}>${NOW_SQL}`;

export function finishMeal(db: D1Database, where: string, values: string[]) {
  return db.prepare(`UPDATE rooms SET completed_at=CASE WHEN ${ALL_DELIVERED} THEN ${NOW_SQL} ELSE ${DEADLINE_SQL} END,
    completion_reason=CASE WHEN ${ALL_DELIVERED} THEN 'delivered' ELSE 'timeout' END,revision=revision+1
    WHERE status='closed' AND completed_at IS NULL AND decided_at IS NOT NULL AND (${where})
    AND (${DEADLINE_SQL}<=${NOW_SQL} OR (${ALL_DELIVERED}))`).bind(...values);
}

export function settleMeals(db: D1Database, where: string, values: string[]) {
  return [
    db.prepare(`UPDATE rooms SET decided_at=?,revision=revision+1 WHERE status='closed' AND decided_at IS NULL AND completed_at IS NULL AND (${where})`).bind(LEGACY_DELIVERY_START,...values),
    finishMeal(db,where,values),
  ];
}

export type LifecycleRow = { status: string; voting_deadline_at?:string|null; decided_at: string | null; completed_at: string | null; completion_reason: MealLifecycle['completion_reason'] };
export function mealLifecycle(row: LifecycleRow): MealLifecycle {
  return {
    voting_deadline_at:row.voting_deadline_at||null,
    phase: row.status==='open' ? 'voting' : row.completed_at ? 'finished' : 'delivery',
    decided_at:row.decided_at,
    delivery_deadline_at:row.decided_at ? new Date(Date.parse(row.decided_at)+12*60*60*1000).toISOString() : null,
    completed_at:row.completed_at,completion_reason:row.completion_reason,
  };
}
