-- Preserve the passing grade used by each exam attempt so historical result
-- status remains stable even when its question bank is edited later.

ALTER TABLE exam_attempts
  ADD COLUMN passing_score TINYINT UNSIGNED NULL AFTER score;

UPDATE exam_attempts AS ea
JOIN question_banks AS qb ON qb.id = ea.question_bank_id
SET ea.passing_score = LEAST(
  100,
  GREATEST(
    0,
    COALESCE(
      CAST(JSON_UNQUOTE(JSON_EXTRACT(ea.snapshot_json, '$.passingScore')) AS UNSIGNED),
      qb.passing_score
    )
  )
)
WHERE ea.passing_score IS NULL;

ALTER TABLE exam_attempts
  MODIFY passing_score TINYINT UNSIGNED NOT NULL;

INSERT INTO schema_versions (version)
VALUES ('20260911_001_add_attempt_passing_score');
