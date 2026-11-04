CREATE TABLE `wechat_bind_codes` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wechat_channels` (
	`user_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`verify_token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_channels_channel_id_unique` ON `wechat_channels` (`channel_id`);--> statement-breakpoint
CREATE TABLE `wechat_links` (
	`channel_id` text NOT NULL,
	`openid` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`channel_id`, `openid`)
);
