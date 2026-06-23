CREATE TABLE `statistics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`totalChaptersGenerated` int DEFAULT 0,
	`totalWordsWritten` int DEFAULT 0,
	`totalCharactersCreated` int DEFAULT 0,
	`totalEventsCreated` int DEFAULT 0,
	`totalLocationsCreated` int DEFAULT 0,
	`lastGenerationDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `statistics_id` PRIMARY KEY(`id`),
	CONSTRAINT `statistics_userId_unique` UNIQUE(`userId`)
);
