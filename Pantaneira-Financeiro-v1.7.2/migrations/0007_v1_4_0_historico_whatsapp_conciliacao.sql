PRAGMA foreign_keys = ON;

-- v1.4.0: histórico por mês, conciliação bancária e integração WhatsApp.
CREATE TABLE IF NOT EXISTS account_balance_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  previous_balance_cents INTEGER NOT NULL,
  new_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_account ON account_balance_adjustments(account_id, created_at);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  message_id TEXT PRIMARY KEY,
  wa_from TEXT NOT NULL,
  message_type TEXT,
  text_body TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from ON whatsapp_messages(wa_from, created_at);

INSERT OR REPLACE INTO settings(key,value) VALUES
  ('historical_entry_start_date','2026-07-01'),
  ('historical_entry_end_date','2026-08-10');
