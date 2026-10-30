CREATE TABLE `goal_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`rest_days` integer NOT NULL,
	`from_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_schedules_goal_idx` ON `goal_schedules` (`goal_id`);