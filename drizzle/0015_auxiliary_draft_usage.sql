ALTER TABLE `userSubscriptions`
  ADD COLUMN `monthlyInspirationUsed` int NOT NULL DEFAULT 0,
  ADD COLUMN `monthlyTextReviewUsed` int NOT NULL DEFAULT 0;
