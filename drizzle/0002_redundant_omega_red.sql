CREATE TABLE `account_secrets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`deepseek_key_ciphertext` text NOT NULL,
	`deepseek_key_iv` text NOT NULL,
	`updated_at` text NOT NULL
);
