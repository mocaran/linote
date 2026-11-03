CREATE TABLE `notes` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`body` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `notes_user_updated_idx` ON `notes` (`user_id`,`updated_at`);