ALTER TABLE `generationJobs`
  MODIFY COLUMN `engine` ENUM('current','runpod_4090','deepseek_free','deepseek_essential','deepseek_ultra','deepseek_review','deepseek_inspiration','open_source_4090','open_source_h100','openai_instant','openai_thinking') NOT NULL DEFAULT 'current',
  MODIFY COLUMN `fallbackEngine` ENUM('current','runpod_4090','deepseek_free','deepseek_essential','deepseek_ultra','deepseek_review','deepseek_inspiration','open_source_4090','open_source_h100','openai_instant','openai_thinking') NULL;
