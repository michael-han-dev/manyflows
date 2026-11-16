CREATE TABLE meta_grants (
  id TEXT PRIMARY KEY,
  meta_app_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  client_business_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER,
  invalidated_at INTEGER,
  generation TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  UNIQUE(meta_app_id,config_id,client_business_id)
);
ALTER TABLE accounts ADD COLUMN grant_id TEXT REFERENCES meta_grants(id);
CREATE INDEX accounts_grant ON accounts(grant_id);
UPDATE accounts SET status='reconnect',sync_error='Reconnect through Meta Unified Login.' WHERE mode='live';
ALTER TABLE accounts DROP COLUMN token;
ALTER TABLE accounts DROP COLUMN token_expires_at;
ALTER TABLE accounts DROP COLUMN permissions;
