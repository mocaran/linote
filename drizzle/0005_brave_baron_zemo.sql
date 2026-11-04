PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wechat_channels` (
	`user_id` text NOT NULL,
	`channel_id` text PRIMARY KEY NOT NULL,
	`verify_token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_wechat_channels`("user_id", "channel_id", "verify_token", "created_at") SELECT "user_id", "channel_id", "verify_token", "created_at" FROM `wechat_channels`;--> statement-breakpoint
DROP TABLE `wechat_channels`;--> statement-breakpoint
ALTER TABLE `__new_wechat_channels` RENAME TO `wechat_channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `wechat_channels_user_idx` ON `wechat_channels` (`user_id`);