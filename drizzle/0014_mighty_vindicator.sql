CREATE TABLE `pickup_plans` (
	`room_id` text NOT NULL,
	`owner` text NOT NULL,
	`time` text DEFAULT '' NOT NULL,
	`place` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`room_id`, `owner`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `restaurant_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`restaurant_ids` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`creation_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_pools_owner` ON `restaurant_pools` (`owner`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `restaurant_id` text REFERENCES restaurants(id);--> statement-breakpoint
ALTER TABLE `restaurants` ADD `media_updated_at` text;