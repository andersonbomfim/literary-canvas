CREATE TABLE `chapterVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chapterId` int NOT NULL,
	`userId` int NOT NULL,
	`content` text NOT NULL,
	`versionNumber` int NOT NULL,
	`changeDescription` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapterVersions_id` PRIMARY KEY(`id`)
);
