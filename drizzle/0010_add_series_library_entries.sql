CREATE TABLE IF NOT EXISTS `seriesLibraryEntries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `seriesId` int NOT NULL,
  `type` varchar(80) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `details` text,
  `sourceWorkIds` text,
  `confidence` int DEFAULT 80,
  `status` enum('canonical','needs_review','conflict') NOT NULL DEFAULT 'needs_review',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `seriesLibraryEntries_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_seriesLibraryEntries_userId` ON `seriesLibraryEntries` (`userId`);
CREATE INDEX `idx_seriesLibraryEntries_seriesId` ON `seriesLibraryEntries` (`seriesId`);
