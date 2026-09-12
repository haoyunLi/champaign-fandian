CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`cuisine` text NOT NULL,
	`address` text NOT NULL,
	`source` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_candidates_room` ON `candidates` (`room_id`);--> statement-breakpoint
CREATE TABLE `restaurants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`cuisine` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`selected` integer DEFAULT 1 NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_restaurants_owner` ON `restaurants` (`owner`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`winner_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_owner_created` ON `rooms` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`voter` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_key` text NOT NULL,
	`candidate_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_votes_room_voter` ON `votes` (`room_id`,`voter`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_votes_room_nickname` ON `votes` (`room_id`,`nickname_key`);