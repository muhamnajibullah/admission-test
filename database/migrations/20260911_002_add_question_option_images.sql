-- Add ordered images to each answer option. Files remain on disk; this table
-- stores only their paths and removes its rows automatically with the option.

CREATE TABLE question_option_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_option_id INT UNSIGNED NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_option_images_position (question_option_id, position),
  INDEX idx_question_option_images_option (question_option_id),
  CONSTRAINT fk_question_option_images_option FOREIGN KEY (question_option_id) REFERENCES question_options(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_versions (version)
VALUES ('20260911_002_add_question_option_images');
