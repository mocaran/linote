CREATE TABLE `wechat_inbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`openid` text NOT NULL,
	`message_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_inbox_message_idx` ON `wechat_inbox` (`channel_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `wechat_inbox_segment_idx` ON `wechat_inbox` (`channel_id`,`openid`,`id`);