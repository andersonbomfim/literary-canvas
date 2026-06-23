-- Keep the precise feedback chosen when a chapter is returned to Writing.
-- `in_writing` represents an existing review that was invalidated by a new
-- author edit; it must not appear in the review queue.
ALTER TABLE `chapterReviews`
  ADD COLUMN `revisionBrief` TEXT NULL AFTER `alerts`,
  ADD COLUMN `revisionFixCount` INT NOT NULL DEFAULT 0 AFTER `revisionBrief`;

ALTER TABLE `chapterReviews`
  MODIFY COLUMN `status`
    ENUM('in_writing', 'pending', 'approved', 'rejected', 'revision_needed')
    NOT NULL DEFAULT 'pending';
