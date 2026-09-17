CREATE TABLE `asteroids` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`drift_anchor_at` integer NOT NULL,
	`resolution` text,
	`resolved_at` integer,
	`captured_goal_id` text,
	`capture_dismissed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`captured_goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asteroids_user_id_idx` ON `asteroids` (`user_id`);