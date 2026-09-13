CREATE TABLE `menu_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_menu_images_owner_created` ON `menu_images` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_menu_images_staged` ON `menu_images` (`published`,`created_at`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `menu_images` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `menu_images` text DEFAULT '[]' NOT NULL;