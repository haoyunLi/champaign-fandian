CREATE TABLE `account_links` (
	`account_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_links_owner` ON `account_links` (`owner`);