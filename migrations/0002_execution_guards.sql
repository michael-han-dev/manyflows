ALTER TABLE campaigns ADD COLUMN live_target_kind TEXT;
ALTER TABLE runs ADD COLUMN last_event_id TEXT;
UPDATE campaigns SET live_target_kind=json_extract((SELECT input FROM versions WHERE id=campaigns.live_version_id),'$.target.kind');
CREATE UNIQUE INDEX next_campaign_claim ON campaigns(account_id) WHERE status='live' AND live_target_kind='next' AND bound_media_id IS NULL;
CREATE TABLE email_captures(event_id TEXT PRIMARY KEY REFERENCES events(id),account_id TEXT NOT NULL,contact_id TEXT NOT NULL,created_at INTEGER NOT NULL);
ALTER TABLE accounts ADD COLUMN last_insights_at INTEGER;
