CREATE TABLE `cancelled_order_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`owner` text NOT NULL,
	`cancelled_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
