-- Add ordered, multiple images to admission-test questions.
-- This is additive: the legacy questions.image_path column is retained for
-- backward compatibility and existing image references are copied.

CREATE TABLE question_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id INT UNSIGNED NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_images_position (question_id, position),
  INDEX idx_question_images_question (question_id),
  CONSTRAINT fk_question_images_question FOREIGN KEY (question_id) REFERENCES questions(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO question_images (question_id, position, image_path)
SELECT id, 1, image_path
FROM questions
WHERE image_path IS NOT NULL AND image_path <> '';

INSERT INTO schema_versions (version)
VALUES ('20260910_002_add_question_images');
