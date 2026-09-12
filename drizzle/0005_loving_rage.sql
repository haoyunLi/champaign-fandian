CREATE TABLE `room_history` (
	`owner` text NOT NULL,
	`room_id` text NOT NULL,
	`created_at` text NOT NULL,
	`hidden_at` text,
	PRIMARY KEY(`owner`, `room_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_orders_owner_room` ON `orders` (`owner`,`room_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_claimant_room` ON `orders` (`claimant`,`room_id`);--> statement-breakpoint
CREATE INDEX `idx_votes_voter_room` ON `votes` (`voter`,`room_id`);