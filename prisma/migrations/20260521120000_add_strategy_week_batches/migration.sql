ALTER TABLE "StrategyArticleTask"
ADD COLUMN "weekKey" VARCHAR(16),
ADD COLUMN "generationBatchId" VARCHAR(80);

CREATE INDEX "StrategyArticleTask_strategyId_weekKey_idx"
ON "StrategyArticleTask"("strategyId", "weekKey");

CREATE INDEX "StrategyArticleTask_generationBatchId_idx"
ON "StrategyArticleTask"("generationBatchId");
