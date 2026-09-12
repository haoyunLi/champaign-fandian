CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`owner` text NOT NULL,
	`nickname` text NOT NULL,
	`dish` text NOT NULL,
	`quantity` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimant` text,
	`claimant_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_orders_room_created` ON `orders` (`room_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `revision` integer DEFAULT 0 NOT NULL;