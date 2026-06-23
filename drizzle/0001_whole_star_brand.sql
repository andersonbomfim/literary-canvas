CREATE TABLE `authorProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`narrativeStyle` text,
	`keyElements` text,
	`characterVoices` text,
	`negativeRules` text,
	`keyChapters` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `authorProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `authorProfiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `chapterReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chapterId` int NOT NULL,
	`userId` int NOT NULL,
	`comments` text,
	`alerts` text,
	`status` enum('pending','approved','rejected','revision_needed') DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chapterReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`draftId` int,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`bookNumber` int,
	`chapterNumber` int,
	`status` enum('canonical','in_development','hypothesis','discarded') DEFAULT 'in_development',
	`generationPrompt` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chapters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`sceneLocation` varchar(255),
	`bookReference` varchar(255),
	`chapterNumber` varchar(50),
	`mainCharacters` text,
	`summary` text,
	`untouchableDialogue` text,
	`untouchableScenes` text,
	`canonicalFacts` text,
	`notes` text,
	`status` enum('draft','sent_to_writing','archived') DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `libraryEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('character','event','location','aura','society') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`details` text,
	`status` enum('canonical','in_development','hypothesis','discarded') DEFAULT 'in_development',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `libraryEntries_id` PRIMARY KEY(`id`)
);
