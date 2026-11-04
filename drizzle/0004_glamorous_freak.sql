CREATE TABLE `trash_items` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `id`)
);
--> statement-breakpoint
CREATE INDEX `trash_user_deleted_idx` ON `trash_items` (`user_id`,`deleted_at`);