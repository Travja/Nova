CREATE TABLE `goal_archive_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`archived_at` integer NOT NULL,
	`restored_at` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_archive_windows_goal_idx` ON `goal_archive_windows` (`goal_id`);