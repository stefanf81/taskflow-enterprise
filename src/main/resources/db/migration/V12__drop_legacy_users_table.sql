-- Clean up the legacy, unused 'users' table that was originally created in V1__init_schema.sql
-- but was completely replaced by 'app_users' in V9__create_users.sql.
DROP TABLE IF EXISTS users CASCADE;
