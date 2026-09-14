ALTER TABLE `entries` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_goal_client_unique` ON `entries` (`goal_id`,`client_id`);