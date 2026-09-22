CREATE TABLE `orbit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_notes_goal_period_idx` ON `orbit_notes` (`goal_id`,`period_key`);