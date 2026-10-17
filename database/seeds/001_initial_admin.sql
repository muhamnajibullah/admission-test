-- Initial installation seed. Import this file once, after database/schema.sql.
-- The schema version guard prevents the default account from being recreated if
-- an administrator later changes or removes it and this file is imported again.

START TRANSACTION;

INSERT INTO admin_users (email, password_hash, display_name, is_active)
SELECT
  'admin@admission.test',
  '$2y$12$VYQXo9U29xEM8fIzqUapgOrluMEH10N1eGMzJdEXetXhI3HgtgOa.',
  'Admission Administrator',
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM schema_versions
  WHERE version = 'seed_20260910_001_initial_admin'
)
AND NOT EXISTS (
  SELECT 1 FROM admin_users
  LIMIT 1
);

INSERT INTO schema_versions (version)
SELECT 'seed_20260910_001_initial_admin'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM schema_versions
  WHERE version = 'seed_20260910_001_initial_admin'
);

COMMIT;
