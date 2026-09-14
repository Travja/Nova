ALTER TABLE `goals` ADD `parent_id` text REFERENCES goals(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `goals_parent_id_idx` ON `goals` (`parent_id`);
