CREATE TABLE `bookSeries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `genre` varchar(120),
  `universeNotes` text,
  `status` enum('active','paused','archived') NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `bookSeries_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_bookSeries_userId` ON `bookSeries` (`userId`);

ALTER TABLE `works` ADD `seriesId` int;
ALTER TABLE `works` ADD `bookNumber` int;
CREATE INDEX `idx_works_seriesId` ON `works` (`seriesId`);
