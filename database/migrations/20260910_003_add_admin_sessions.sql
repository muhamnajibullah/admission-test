-- Store administrator sessions in MySQL so authentication remains stable on
-- shared hosting where PHP filesystem sessions may be unavailable or cleaned.

CREATE TABLE admin_sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  session_data MEDIUMBLOB NOT NULL,
  last_activity DATETIME NOT NULL,
  INDEX idx_admin_sessions_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_versions (version)
VALUES ('20260910_003_add_admin_sessions');
