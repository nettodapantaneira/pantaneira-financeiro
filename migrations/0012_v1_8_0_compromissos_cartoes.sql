PRAGMA foreign_keys = ON;

-- Pantaneira Financeiro v1.8.0
-- Compromissos, cartões de crédito de uso misto e faturas editáveis.

INSERT OR IGNORE INTO categories(name,nature) VALUES
  ('Pagamento de fatura de cartão','business_debt'),
  ('Rendimentos financeiros','income');

CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  issuer TEXT,
  limit_cents INTEGER,
  closing_day INTEGER CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  preferred_account_id INTEGER REFERENCES accounts(id),
  mixed_use INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_card_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES credit_cards(id),
  period_key TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  due_date TEXT NOT NULL,
  closing_date TEXT,
  obligation_id INTEGER REFERENCES obligations(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue','void')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(card_id,period_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_card_bills_due ON credit_card_bills(due_date,status);
CREATE INDEX IF NOT EXISTS idx_credit_card_bills_card ON credit_card_bills(card_id,period_key);

CREATE TABLE IF NOT EXISTS credit_card_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES credit_card_bills(id),
  purchase_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  scope TEXT NOT NULL CHECK (scope IN ('business','personal')),
  nature TEXT NOT NULL CHECK (nature IN ('business_operating','inventory','business_debt','personal_withdrawal')),
  category_id INTEGER REFERENCES categories(id),
  installment_number INTEGER,
  installment_total INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_card_items_bill ON credit_card_items(bill_id,status);

CREATE TABLE IF NOT EXISTS credit_card_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES credit_card_bills(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at TEXT NOT NULL,
  source_account_id INTEGER NOT NULL REFERENCES accounts(id),
  payment_method TEXT NOT NULL DEFAULT 'transfer' CHECK (payment_method IN ('pix','cash','debit','credit','transfer','boleto','other')),
  transaction_id INTEGER REFERENCES transactions(id),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_card_payments_bill ON credit_card_payments(bill_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_card_payments_transaction ON credit_card_payments(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_card_payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES credit_card_payments(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES credit_card_items(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payment_id,item_id)
);

CREATE TABLE IF NOT EXISTS credit_card_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_card_revisions_entity ON credit_card_revisions(entity_type,entity_id,created_at);
