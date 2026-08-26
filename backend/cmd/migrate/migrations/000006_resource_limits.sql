-- 000006_resource_limits.sql
-- Onidel-style resource limits: caps apply ONLY to on-demand HOURLY instances
-- and span every team (organization) the limited user owns. Enforcement lives
-- in internal/compute/resource_limits.go.

ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hourly_instances integer NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_instance_monthly_cost numeric(20,4) NOT NULL DEFAULT 25.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS limit_currency char(3) NOT NULL DEFAULT 'USD';
