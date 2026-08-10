-- v1.2.1 - auditoria de edição/cancelamento de lançamentos
CREATE TABLE IF NOT EXISTS transaction_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  action TEXT NOT NULL CHECK (action IN ('edit','void')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transaction_revisions_transaction ON transaction_revisions(transaction_id, created_at);

ALTER TABLE transactions ADD COLUMN updated_at TEXT;
UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL;
