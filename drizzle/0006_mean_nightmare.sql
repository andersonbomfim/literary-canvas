ALTER TABLE `characters` ADD `family` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `birthDate` varchar(100);--> statement-breakpoint
ALTER TABLE `characters` ADD `speechStyle` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `psychologicalProfile` text;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `resetTokenHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `resetTokenExpiresAt` timestamp;