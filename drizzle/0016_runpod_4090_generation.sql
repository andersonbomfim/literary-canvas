ALTER TABLE `generationJobs`
  MODIFY COLUMN `engine` ENUM('current','runpod_4090','open_source_4090','open_source_h100','openai_instant','openai_thinking') NOT NULL DEFAULT 'current',
  MODIFY COLUMN `fallbackEngine` ENUM('current','runpod_4090','open_source_4090','open_source_h100','openai_instant','openai_thinking') NULL;

ALTER TABLE `generationCostLogs`
  ADD COLUMN `inputCharCount` INT NOT NULL DEFAULT 0 AFTER `outputWordCount`,
  ADD COLUMN `outputCharCount` INT NOT NULL DEFAULT 0 AFTER `inputCharCount`,
  ADD COLUMN `providerRequestId` VARCHAR(255) NULL AFTER `outputCharCount`,
  ADD COLUMN `fallbackUsed` INT NOT NULL DEFAULT 0 AFTER `providerRequestId`;
