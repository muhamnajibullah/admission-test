# Database migrations

This directory contains database changes made after the initial baseline. The
baseline itself remains in `database/schema.sql`; do not import that file again
on a database that is already in use.

## Naming

Copy `00000000_000_template.sql.example` and use this format:

```text
YYYYMMDD_NNN_short_description.sql
```

Examples:

```text
20261001_001_add_parent_phone.sql
20261001_002_index_application_status.sql
```

Use the date on which the migration is created and increment `NNN` when several
migrations share a date. Never rename or edit a migration that has already been
applied to any environment.

## Writing a migration

- Prefer backward-compatible additions first, such as a nullable column or a
  new table.
- Keep one purpose per migration.
- Do not include `CREATE DATABASE` or `USE`; select the target database before
  importing.
- Avoid destructive statements such as `DROP`, `TRUNCATE`, or an unrestricted
  `DELETE`. Perform destructive changes only in a later, reviewed migration
  after the application no longer depends on the old data.
- Add the matching row to `schema_versions` as the final statement. Do not use
  `INSERT IGNORE`, because accidentally running the same migration twice should
  produce a visible error.
- MariaDB/MySQL DDL may commit implicitly. Always take a database backup; do not
  rely on `ROLLBACK` to undo an `ALTER TABLE`.

## Applying migrations

1. Export a backup of the target database.
2. Check which versions have already been applied:

   ```sql
   SELECT version, applied_at
   FROM schema_versions
   ORDER BY applied_at, version;
   ```

3. Import only missing `.sql` files, in ascending filename order.
4. Confirm the new version appears in `schema_versions`.
5. Test the affected application feature before applying the next migration.

In cPanel, select the application database in phpMyAdmin, choose **Import**, and
upload one migration at a time. For a new installation, follow
`database/README.md` instead.
