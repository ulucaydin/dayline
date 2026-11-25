CREATE TABLE `dayline_tasks` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`revision` integer NOT NULL,
	`change_key` text NOT NULL,
	`task_json` text,
	PRIMARY KEY(`owner_id`, `task_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dayline_owner_revision` ON `dayline_tasks` (`owner_id`,`revision`);