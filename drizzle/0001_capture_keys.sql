CREATE TABLE `dayline_capture_keys` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`nonce` text NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`)
);
