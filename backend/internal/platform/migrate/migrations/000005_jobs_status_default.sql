-- jobs.status lacked a default while several enqueue sites omit the column.
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'queued';
