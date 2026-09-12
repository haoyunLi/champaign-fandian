import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const restaurants = sqliteTable('restaurants', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  cuisine: text('cuisine').notNull(), address: text('address').notNull().default(''),
  source: text('source').notNull().default(''), selected: integer('selected').notNull().default(1),
  position: integer('position').notNull(), deleted: integer('deleted').notNull().default(0),
}, t => [index('idx_restaurants_owner').on(t.owner)]);
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull(),
  status: text('status').notNull().default('open'), winnerId: text('winner_id'),
  mode: text('mode').notNull().default('random'),
  creationRequestHash: text('creation_request_hash'), ordersStoppedAt: text('orders_stopped_at'),
  decidedAt: text('decided_at'), completedAt: text('completed_at'), completionReason: text('completion_reason'),
  createdAt: text('created_at').notNull(), revision: integer('revision').notNull().default(0), deletedAt: text('deleted_at'),
}, t => [index('idx_rooms_owner_created').on(t.owner, t.createdAt)]);
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id),
  name: text('name').notNull(), cuisine: text('cuisine').notNull(), address: text('address').notNull(),
  source: text('source').notNull(), position: integer('position').notNull(),
}, t => [index('idx_candidates_room').on(t.roomId)]);
export const votes = sqliteTable('votes', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id),
  voter: text('voter').notNull(), nickname: text('nickname').notNull(), nicknameKey: text('nickname_key').notNull(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_votes_room_voter').on(t.roomId,t.voter), uniqueIndex('idx_votes_room_nickname').on(t.roomId,t.nicknameKey), index('idx_votes_voter_room').on(t.voter,t.roomId)]);
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id), owner: text('owner').notNull(),
  nickname: text('nickname').notNull(), dish: text('dish').notNull(), quantity: integer('quantity').notNull(), note: text('note').notNull().default(''),
  creationRequestHash: text('creation_request_hash'),
  status: text('status').notNull().default('pending'), revision: integer('revision').notNull().default(0), claimant: text('claimant'), claimantName: text('claimant_name'), createdAt: text('created_at').notNull(),
}, t => [index('idx_orders_room_created').on(t.roomId,t.createdAt), index('idx_orders_owner_room').on(t.owner,t.roomId), index('idx_orders_claimant_room').on(t.claimant,t.roomId)]);
export const roomHistory = sqliteTable('room_history', {
  owner: text('owner').notNull(), roomId: text('room_id').notNull().references(() => rooms.id),
  createdAt: text('created_at').notNull(), hiddenAt: text('hidden_at'),
}, t => [primaryKey({columns:[t.owner,t.roomId]})]);
export const visitorPreferences = sqliteTable('visitor_preferences', {
  owner: text('owner').primaryKey(), nickname: text('nickname').notNull(),
});
// Retain only request identities after cancellation so late retries cannot recreate an order.
export const cancelledOrderRequests = sqliteTable('cancelled_order_requests', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id),
  owner: text('owner').notNull(), cancelledAt: text('cancelled_at').notNull(),
});
