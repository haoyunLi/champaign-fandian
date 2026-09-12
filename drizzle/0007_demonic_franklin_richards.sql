CREATE TABLE `visitor_preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `revision` integer DEFAULT 0 NOT NULL;