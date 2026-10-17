# Admission Test

Native HTML, CSS, JavaScript, and PHP 7.4 application for new-student admission exams.

## Setup

1. Create the `alazkasch_admission_test` database. Local MySQL users can run `database/create-local-database.sql`.
2. Select that database and import `database/schema.sql` once.
3. Import `database/seeds/001_initial_admin.sql` once.
4. Local XAMPP/Laragon can use the built-in `root`/blank-password defaults. If your local credentials differ, copy `config/database.example.php` to `config/database.php` and override them.
5. On cPanel, either set `ADMISSION_DB_HOST`, `ADMISSION_DB_PORT`, `ADMISSION_DB_NAME`, `ADMISSION_DB_USER`, and `ADMISSION_DB_PASS`, or create `config/database.php` with the hosting credentials. This ignored file must not be committed.
6. Ensure `storage/uploads/questions` is writable by PHP.
7. Serve the project through PHP/Apache and open `index.html`.

The one-time seed creates `admin@admission.test` with password `Alazka2026`. Change this password after the first deployment. The seed records its own version and cannot recreate the default account when imported again.

Normal API requests never execute schema DDL. Keep `database/schema.sql` as the initial baseline and put every later change in a new, ordered file under `database/migrations`. See `database/README.md` for local and cPanel instructions.

## Local server

Run `./start-local-server.ps1`, then open `http://127.0.0.1:8000/`.
