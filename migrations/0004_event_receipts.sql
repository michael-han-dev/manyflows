CREATE TABLE event_receipts (digest TEXT PRIMARY KEY);
ALTER TABLE events ADD COLUMN receipt_hash TEXT;
