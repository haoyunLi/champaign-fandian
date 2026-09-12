import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const restaurants = sqliteTable('restaurants', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  cuisine: text('cuisine').notNull(), address: text('address').notNull().default(''),
  source: text('source').notNull().default(''), selected: integer('selected').notNull().default(1),
  position: integer('position').notNull(), deleted: integer('deleted').notNull().default(0),
}, t => [index('idx_restaurants_owner').on(t.owner)]);
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull(),
  status: text('status').notNull().default('open'), winnerId: text('winner_id'),
  createdAt: text('created_at').notNull(), revision: integer('revision').notNull().default(0),
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
}, t => [uniqueIndex('idx_votes_room_voter').on(t.roomId,t.voter), uniqueIndex('idx_votes_room_nickname').on(t.roomId,t.nicknameKey)]);
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id), owner: text('owner').notNull(),
  nickname: text('nickname').notNull(), dish: text('dish').notNull(), quantity: integer('quantity').notNull(), note: text('note').notNull().default(''),
  status: text('status').notNull().default('pending'), claimant: text('claimant'), claimantName: text('claimant_name'), createdAt: text('created_at').notNull(),
}, t => [index('idx_orders_room_created').on(t.roomId,t.createdAt)]);
