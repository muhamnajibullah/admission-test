# Database installation and updates

The database files have separate responsibilities:

```text
database/
|-- create-local-database.sql          Local database creation only
|-- schema.sql                         Initial empty-database baseline
|-- seeds/
|   `-- 001_initial_admin.sql          One-time initial administrator
`-- migrations/
    |-- README.md                      Migration rules and procedure
    `-- *.sql                          Ordered future changes
```

## First installation: local

From the project directory, run:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root --execute="SOURCE database/create-local-database.sql"
& "C:\xampp\mysql\bin\mysql.exe" -u root alazkasch_admission_test --execute="SOURCE database/schema.sql"
& "C:\xampp\mysql\bin\mysql.exe" -u root alazkasch_admission_test --execute="SOURCE database/seeds/001_initial_admin.sql"
```

If the local root account has a password, add `-p` to each command.

## First installation: cPanel

1. Create the database and database user in **MySQL Databases** and grant the
   user privileges on that database.
2. Open phpMyAdmin and select the newly created application database.
3. Import `database/schema.sql`.
4. Import `database/seeds/001_initial_admin.sql` once.
5. Configure the actual prefixed cPanel database name, user, and password in
   `config/database.php`.
6. Sign in as `admin@admission.test` / `Alazka2026`, then change the initial
   password for production use.

Do not import `create-local-database.sql` on cPanel. cPanel commonly controls
database creation and prefixes database and user names.

## Existing database

Never import `schema.sql` or the initial seed again. Back up the database and
apply only missing files from `database/migrations`, in filename order. See
`database/migrations/README.md` for the complete workflow.
