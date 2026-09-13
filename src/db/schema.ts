import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const restaurants = sqliteTable('restaurants', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  cuisine: text('cuisine').notNull(), address: text('address').notNull().default(''),
  source: text('source').notNull().default(''), menuImages: text('menu_images').notNull().default('[]'), selected: integer('selected').notNull().default(1),
  revision: integer('revision').notNull().default(0), position: integer('position').notNull(), deleted: integer('deleted').notNull().default(0), mediaUpdatedAt: text('media_updated_at'),
}, t => [index('idx_restaurants_owner').on(t.owner)]);
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull(),
  status: text('status').notNull().default('open'), winnerId: text('winner_id'),
  mode: text('mode').notNull().default('random'),
  creationRequestHash: text('creation_request_hash'), ordersStoppedAt: text('orders_stopped_at'),
  decidedAt: text('decided_at'), completedAt: text('completed_at'), completionReason: text('completion_reason'),
  createdAt: text('created_at').notNull(), revision: integer('revision').notNull().default(0), deletedAt: text('deleted_at'),
  votingDeadlineAt: text('voting_deadline_at'),
}, t => [index('idx_rooms_owner_created').on(t.owner, t.createdAt)]);
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id),
  name: text('name').notNull(), cuisine: text('cuisine').notNull(), address: text('address').notNull(),
  source: text('source').notNull(), menuImages: text('menu_images').notNull().default('[]'), position: integer('position').notNull(),
  restaurantId: text('restaurant_id').references(()=>restaurants.id),
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
  purchaseStatus:text('purchase_status').notNull().default('unplaced'),issueNote:text('issue_note').notNull().default(''),changeRequest:text('change_request'),
}, t => [index('idx_orders_room_created').on(t.roomId,t.createdAt), index('idx_orders_owner_room').on(t.owner,t.roomId), index('idx_orders_claimant_room').on(t.claimant,t.roomId)]);
export const roomHistory = sqliteTable('room_history', {
  owner: text('owner').notNull(), roomId: text('room_id').notNull().references(() => rooms.id),
  createdAt: text('created_at').notNull(), hiddenAt: text('hidden_at'),
}, t => [primaryKey({columns:[t.owner,t.roomId]})]);
export const visitorPreferences = sqliteTable('visitor_preferences', {
  owner: text('owner').primaryKey(), nickname: text('nickname').notNull(),
  nicknameKey: text('nickname_key'), revision: integer('revision').notNull().default(0),
});
// Retain only request identities after cancellation so late retries cannot recreate an order.
export const cancelledOrderRequests = sqliteTable('cancelled_order_requests', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(() => rooms.id),
  owner: text('owner').notNull(), cancelledAt: text('cancelled_at').notNull(),
});

// Only a trusted Sites sign-in can resolve an account to its existing visitor data.
export const accountLinks = sqliteTable('account_links', {
  accountId: text('account_id').primaryKey(), owner: text('owner').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_account_links_owner').on(t.owner)]);

export const menuImages = sqliteTable('menu_images', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), contentType: text('content_type').notNull(),
  size: integer('size').notNull(), contentHash: text('content_hash').notNull(), createdAt: text('created_at').notNull(),
  ready: integer('ready').notNull().default(0), published: integer('published').notNull().default(0),
}, t => [index('idx_menu_images_owner_created').on(t.owner,t.createdAt), index('idx_menu_images_staged').on(t.published,t.createdAt)]);

export const restaurantPools = sqliteTable('restaurant_pools', {
  id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),restaurantIds:text('restaurant_ids').notNull(),
  revision:integer('revision').notNull().default(1),creationHash:text('creation_hash').notNull(),createdAt:text('created_at').notNull(),deletedAt:text('deleted_at'),
},t=>[index('idx_restaurant_pools_owner').on(t.owner)]);
export const pickupPlans = sqliteTable('pickup_plans', {
  roomId:text('room_id').notNull().references(()=>rooms.id),owner:text('owner').notNull(),
  time:text('time').notNull().default(''),place:text('place').notNull().default(''),revision:integer('revision').notNull().default(1),
},t=>[primaryKey({columns:[t.roomId,t.owner]})]);
export const notifications=sqliteTable('notifications',{
  id:integer('id').primaryKey({autoIncrement:true}),owner:text('owner').notNull(),roomId:text('room_id').notNull().references(()=>rooms.id),
  message:text('message').notNull(),createdAt:text('created_at').notNull(),readAt:text('read_at'),
},t=>[index('idx_notifications_owner_id').on(t.owner,t.id)]);

export const orderDrafts=sqliteTable('order_drafts',{
  roomId:text('room_id').notNull().references(()=>rooms.id),owner:text('owner').notNull(),
  payload:text('payload'),revision:integer('revision').notNull().default(0),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.roomId,t.owner]})]);
