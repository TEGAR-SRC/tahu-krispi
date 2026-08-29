-- Containers (LXC) become a first-class service kind.
-- Kept in its own migration file: cmd/migrate/main.go wraps every file in one
-- transaction, and PostgreSQL refuses to USE an enum value inside the very
-- transaction that added it ("unsafe use of new value"), so the instances
-- column + product seed referencing 'container' live in
-- 000016_container_support.sql.

ALTER TYPE app.service_kind ADD VALUE IF NOT EXISTS 'container';
