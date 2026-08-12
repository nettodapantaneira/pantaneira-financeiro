PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_scope TEXT NOT NULL CHECK (owner_scope IN ('business','personal')),
  account_type TEXT NOT NULL CHECK (account_type IN ('bank','cash','card','other')),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nature TEXT NOT NULL CHECK (nature IN ('business_operating','inventory','business_debt','personal_withdrawal','income','transfer','unidentified')),
  parent_id INTEGER REFERENCES categories(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique ON categories(name, nature, COALESCE(parent_id, 0));

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  creditor TEXT,
  scope TEXT NOT NULL DEFAULT 'business' CHECK (scope IN ('business','personal')),
  original_balance_cents INTEGER,
  current_balance_cents INTEGER,
  monthly_target_cents INTEGER,
  installment_cents INTEGER,
  due_day INTEGER CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
  flexible INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','paid','unknown')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('business','personal')),
  nature TEXT NOT NULL CHECK (nature IN ('business_operating','inventory','business_debt','personal_withdrawal')),
  category_id INTEGER REFERENCES categories(id),
  debt_id INTEGER REFERENCES debts(id),
  monthly_target_cents INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
  recurring INTEGER NOT NULL DEFAULT 1,
  flexible INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 3,
  counts_in_daily_target INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  obligation_id INTEGER NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reserves_obligation_period ON reserves(obligation_id, period_key);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  period_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('income','expense','transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  source_account_id INTEGER REFERENCES accounts(id),
  destination_account_id INTEGER REFERENCES accounts(id),
  nature TEXT NOT NULL CHECK (nature IN ('business_operating','inventory','business_debt','personal_withdrawal','income','transfer','unidentified')),
  category_id INTEGER REFERENCES categories(id),
  obligation_id INTEGER REFERENCES obligations(id),
  debt_id INTEGER REFERENCES debts(id),
  description TEXT NOT NULL,
  notes TEXT,
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('pix','cash','debit','credit','transfer','boleto','other')),
  recurrence_type TEXT NOT NULL DEFAULT 'eventual' CHECK (recurrence_type IN ('eventual','recurring')),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending_reclassification','void')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_period_key ON transactions(period_key);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination ON transactions(destination_account_id);

CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  expected_cents INTEGER NOT NULL,
  actual_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('business','personal')),
  nature TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  reference_amount_cents INTEGER,
  recurrence_type TEXT NOT NULL DEFAULT 'eventual' CHECK (recurrence_type IN ('eventual','recurring','variable_recurring')),
  counts_in_daily_target INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO settings(key, value) VALUES
  ('workdays_per_month', '25'),
  ('working_weekdays', '1,2,3,4,5,6'),
  ('currency', 'BRL'),
  ('timezone', 'America/Cuiaba'),
  ('daily_target_mode', 'due_date_first');

INSERT INTO accounts(name, owner_scope, account_type, notes) VALUES
  ('Conta da Pantaneira', 'business', 'bank', 'Saldo inicial deve ser informado no primeiro acesso.'),
  ('Dinheiro físico', 'business', 'cash', 'Caixa/dinheiro em mãos. Deve ser conferido periodicamente.'),
  ('Conta pessoal', 'personal', 'bank', 'Opcional: use quando uma despesa sair diretamente de conta pessoal.'),
  ('Dinheiro pessoal', 'personal', 'cash', 'Opcional: dinheiro que não saiu do caixa da empresa.');

INSERT INTO categories(name, nature) VALUES
  ('Aluguel e ocupação', 'business_operating'),
  ('Energia', 'business_operating'),
  ('Internet', 'business_operating'),
  ('Funcionários', 'business_operating'),
  ('Contabilidade', 'business_operating'),
  ('Impostos correntes', 'business_operating'),
  ('Sistemas e aplicativos', 'business_operating'),
  ('Compras e estoque', 'inventory'),
  ('Empréstimos e acordos', 'business_debt'),
  ('Moradia', 'personal_withdrawal'),
  ('Família e pensão', 'personal_withdrawal'),
  ('Transporte', 'personal_withdrawal'),
  ('Viagem', 'personal_withdrawal'),
  ('Alimentação', 'personal_withdrawal'),
  ('Doações', 'personal_withdrawal'),
  ('Acordos pessoais', 'personal_withdrawal'),
  ('Lazer e compras', 'personal_withdrawal'),
  ('Receita de vendas', 'income'),
  ('Transferência entre contas', 'transfer'),
  ('Não identificado', 'unidentified');

INSERT INTO debts(name, creditor, scope, original_balance_cents, current_balance_cents, monthly_target_cents, installment_cents, due_day, flexible, priority, status, notes) VALUES
  ('Empréstimo Banco X', 'Banco X', 'business', NULL, NULL, 120000, 120000, 15, 0, 2, 'active', 'Saldo total ainda não informado.'),
  ('Dívida Chico Dal Magro', 'Chico Dal Magro', 'business', 8500000, 8500000, 500000, NULL, NULL, 0, 2, 'active', 'Meta média de pagamento de R$ 5.000/mês.'),
  ('Acerto funcionário', 'Funcionário', 'business', 150000, 150000, NULL, NULL, NULL, 0, 2, 'active', 'Saldo informado de R$ 1.500.'),
  ('Compra da participação da ex', 'Ex-sócia', 'personal', NULL, NULL, 300000, NULL, NULL, 1, 5, 'active', 'Meta de R$ 3.000 quando houver disponibilidade; não tratar como obrigação rígida.');

INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Aluguel loja', 'business', 'business_operating', id, 350000, 10, 1, 0, 1, 1, 'Despesa fixa.' FROM categories WHERE name='Aluguel e ocupação' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Energia loja', 'business', 'business_operating', id, 80000, 20, 1, 0, 1, 1, 'Média mensal.' FROM categories WHERE name='Energia' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Internet loja', 'business', 'business_operating', id, 20000, 20, 1, 0, 1, 1, 'Despesa fixa.' FROM categories WHERE name='Internet' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Funcionários', 'business', 'business_operating', id, 250000, NULL, 1, 0, 1, 1, 'Vencimento a informar.' FROM categories WHERE name='Funcionários' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Contador', 'business', 'business_operating', id, 75000, NULL, 1, 0, 1, 1, 'Vencimento a informar.' FROM categories WHERE name='Contabilidade' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Impostos correntes', 'business', 'business_operating', id, 150000, NULL, 1, 0, 1, 1, 'Média mensal; vencimento a informar.' FROM categories WHERE name='Impostos correntes' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'ERP', 'business', 'business_operating', id, 29289, NULL, 1, 0, 3, 1, 'Valor mensal oficial informado.' FROM categories WHERE name='Sistemas e aplicativos' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'ChatGPT loja', 'business', 'business_operating', id, 9900, NULL, 1, 0, 3, 1, 'Aplicativo usado na loja.' FROM categories WHERE name='Sistemas e aplicativos' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Vectorize', 'business', 'business_operating', id, 5900, NULL, 1, 0, 3, 1, 'Aplicativo usado na loja.' FROM categories WHERE name='Sistemas e aplicativos' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Canva', 'business', 'business_operating', id, 5900, NULL, 1, 0, 3, 1, 'Aplicativo usado na loja.' FROM categories WHERE name='Sistemas e aplicativos' AND nature='business_operating';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Orçamento compras/estoque', 'business', 'inventory', id, 1000000, NULL, 1, 1, 3, 0, 'Referência variável de R$ 10.000/mês. Não entra automaticamente como despesa fixa/meta diária.' FROM categories WHERE name='Compras e estoque' AND nature='inventory';

INSERT INTO obligations(name, scope, nature, category_id, debt_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Parcela Banco X', 'business', 'business_debt', c.id, d.id, 120000, 15, 1, 0, 2, 1, 'Parcela mensal.' FROM categories c JOIN debts d ON d.name='Empréstimo Banco X' WHERE c.name='Empréstimos e acordos' AND c.nature='business_debt';
INSERT INTO obligations(name, scope, nature, category_id, debt_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Pagamento Chico Dal Magro', 'business', 'business_debt', c.id, d.id, 500000, NULL, 1, 0, 2, 1, 'Pagamento médio mensal da dívida.' FROM categories c JOIN debts d ON d.name='Dívida Chico Dal Magro' WHERE c.name='Empréstimos e acordos' AND c.nature='business_debt';

INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Aluguel casa', 'personal', 'personal_withdrawal', id, 120000, NULL, 1, 0, 4, 1, 'Retirada pessoal paga pelo caixa da empresa quando aplicável.' FROM categories WHERE name='Moradia' AND nature='personal_withdrawal';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Internet casa', 'personal', 'personal_withdrawal', id, 10900, NULL, 1, 0, 4, 1, 'Despesa pessoal recorrente.' FROM categories WHERE name='Moradia' AND nature='personal_withdrawal';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Água casa', 'personal', 'personal_withdrawal', id, 10900, NULL, 1, 0, 4, 1, 'Despesa pessoal recorrente.' FROM categories WHERE name='Moradia' AND nature='personal_withdrawal';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Pensão', 'personal', 'personal_withdrawal', id, 150000, NULL, 1, 0, 4, 1, 'Despesa pessoal recorrente.' FROM categories WHERE name='Família e pensão' AND nature='personal_withdrawal';
INSERT INTO obligations(name, scope, nature, category_id, debt_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Acordo participação ex', 'personal', 'personal_withdrawal', c.id, d.id, 300000, NULL, 1, 1, 5, 1, 'Meta flexível: pagar conforme disponibilidade.' FROM categories c JOIN debts d ON d.name='Compra da participação da ex' WHERE c.name='Acordos pessoais' AND c.nature='personal_withdrawal';
INSERT INTO obligations(name, scope, nature, category_id, monthly_target_cents, due_day, recurring, flexible, priority, counts_in_daily_target, notes)
SELECT 'Doações', 'personal', 'personal_withdrawal', id, 25900, NULL, 1, 1, 5, 0, 'Média de referência. Variável; não entra automaticamente na meta rígida.' FROM categories WHERE name='Doações' AND nature='personal_withdrawal';

INSERT INTO expense_templates(name, scope, nature, category_id, reference_amount_cents, recurrence_type, counts_in_daily_target, notes)
SELECT 'Gasolina - ida Cuiabá', 'personal', 'personal_withdrawal', id, 50000, 'eventual', 0, 'Exemplo/referência de gasto pessoal eventual. Quando pago pela Pantaneira, registrar como retirada pessoal e informar a origem do dinheiro.' FROM categories WHERE name='Viagem' AND nature='personal_withdrawal';
