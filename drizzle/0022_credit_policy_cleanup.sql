-- Credit policy cleanup:
-- - one wallet per user
-- - one subscription row per user
-- - faster idempotency checks for monthly flexible-credit grants

UPDATE `creditWallets` wallet
JOIN (
  SELECT `userId`, MIN(`id`) AS keepId, SUM(`balance`) AS totalBalance
  FROM `creditWallets`
  GROUP BY `userId`
  HAVING COUNT(*) > 1
) duplicateWallets
  ON wallet.`id` = duplicateWallets.keepId
SET wallet.`balance` = duplicateWallets.totalBalance;

DELETE wallet
FROM `creditWallets` wallet
JOIN (
  SELECT `userId`, MIN(`id`) AS keepId
  FROM `creditWallets`
  GROUP BY `userId`
  HAVING COUNT(*) > 1
) duplicateWallets
  ON wallet.`userId` = duplicateWallets.`userId`
 AND wallet.`id` <> duplicateWallets.keepId;

DELETE oldSubscription
FROM `userSubscriptions` oldSubscription
JOIN `userSubscriptions` newerSubscription
  ON newerSubscription.`userId` = oldSubscription.`userId`
 AND (
   newerSubscription.`updatedAt` > oldSubscription.`updatedAt`
   OR (
     newerSubscription.`updatedAt` = oldSubscription.`updatedAt`
     AND newerSubscription.`id` > oldSubscription.`id`
   )
 );

ALTER TABLE `creditWallets`
  ADD UNIQUE INDEX `uniq_creditWallets_userId` (`userId`);

ALTER TABLE `userSubscriptions`
  ADD UNIQUE INDEX `uniq_userSubscriptions_userId` (`userId`);

ALTER TABLE `creditLedgerEntries`
  ADD INDEX `idx_creditLedgerEntries_user_reference` (`userId`, `reference`);
