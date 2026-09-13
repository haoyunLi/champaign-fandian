CREATE TABLE `order_drafts` (
	`room_id` text NOT NULL,
	`owner` text NOT NULL,
	`payload` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`room_id`, `owner`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `restaurants` ADD `revision` integer DEFAULT 0 NOT NULL;