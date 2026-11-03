CREATE TABLE `accounts` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`mode` text NOT NULL,
	`title` text NOT NULL,
	`scope` text NOT NULL,
	`note_count` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `insights_user_created_idx` ON `insights` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);