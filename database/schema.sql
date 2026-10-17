-- Initial database baseline.
-- Import this file once into an empty alazkasch_admission_test database.
-- After installation, apply ordered files from database/migrations instead of
-- importing this baseline again.

CREATE TABLE IF NOT EXISTS schema_versions (
  version VARCHAR(40) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT 'Admission Administrator',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_hash CHAR(64) NOT NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_attempts_ip_time (ip_hash, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  session_data MEDIUMBLOB NOT NULL,
  last_activity DATETIME NOT NULL,
  INDEX idx_admin_sessions_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_access_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_hash CHAR(64) NOT NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exam_access_ip_time (ip_hash, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS units (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  city ENUM('Jakarta','Surabaya') NOT NULL,
  description TEXT NULL,
  active_question_bank_id INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_units_name_city (name, city),
  INDEX idx_units_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_banks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  unit_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  passing_score TINYINT UNSIGNED NOT NULL DEFAULT 75,
  duration_seconds INT UNSIGNED NOT NULL,
  shuffle_questions TINYINT(1) NOT NULL DEFAULT 1,
  shuffle_options TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_question_banks_unit (unit_id),
  CONSTRAINT fk_question_banks_unit FOREIGN KEY (unit_id) REFERENCES units(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_bank_id INT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  content_html TEXT NOT NULL,
  image_path VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_questions_bank_position (question_bank_id, position),
  CONSTRAINT fk_questions_bank FOREIGN KEY (question_bank_id) REFERENCES question_banks(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_images (
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

CREATE TABLE IF NOT EXISTS question_options (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id INT UNSIGNED NOT NULL,
  option_key CHAR(1) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  content_html TEXT NOT NULL,
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_question_option_key (question_id, option_key),
  INDEX idx_question_options_position (question_id, position),
  CONSTRAINT fk_options_question FOREIGN KEY (question_id) REFERENCES questions(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_option_images (
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

CREATE TABLE IF NOT EXISTS exam_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  token_last_four CHAR(4) NOT NULL,
  expires_at DATETIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exam_tokens_lookup (token_hash, is_active, expires_at),
  INDEX idx_exam_tokens_active (is_active, expires_at),
  CONSTRAINT fk_exam_tokens_admin FOREIGN KEY (created_by) REFERENCES admin_users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_applications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  registration_number VARCHAR(24) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  birth_date DATE NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_applications_registration (registration_number),
  INDEX idx_applications_unit (unit_id),
  CONSTRAINT fk_applications_unit FOREIGN KEY (unit_id) REFERENCES units(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(64) NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  question_bank_id INT UNSIGNED NOT NULL,
  exam_token_id BIGINT UNSIGNED NULL,
  snapshot_json LONGTEXT NOT NULL,
  answers_json LONGTEXT NULL,
  flagged_json LONGTEXT NULL,
  started_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  submitted_at DATETIME NULL,
  status ENUM('in_progress','submitted','expired') NOT NULL DEFAULT 'in_progress',
  score TINYINT UNSIGNED NULL,
  passing_score TINYINT UNSIGNED NOT NULL,
  correct_count INT UNSIGNED NOT NULL DEFAULT 0,
  wrong_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_questions INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_attempts_public (public_id),
  UNIQUE KEY uq_attempts_application (application_id),
  INDEX idx_attempts_status_submitted (status, submitted_at),
  INDEX idx_attempts_bank (question_bank_id),
  CONSTRAINT fk_attempts_application FOREIGN KEY (application_id) REFERENCES student_applications(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_attempts_bank FOREIGN KEY (question_bank_id) REFERENCES question_banks(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_attempts_token FOREIGN KEY (exam_token_id) REFERENCES exam_tokens(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_versions (version)
VALUES
  ('20260910_001_initial_schema'),
  ('20260910_002_add_question_images'),
  ('20260910_003_add_admin_sessions'),
  ('20260911_001_add_attempt_passing_score'),
  ('20260911_002_add_question_option_images');
