ALTER TABLE actions ADD COLUMN started_at INTEGER;
UPDATE actions SET started_at=updated_at WHERE status='succeeded';
ALTER TABLE runs ADD COLUMN lock_token TEXT;
