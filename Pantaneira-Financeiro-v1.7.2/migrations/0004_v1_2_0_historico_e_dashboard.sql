PRAGMA foreign_keys = ON;

-- Pantaneira Financeiro v1.2.0
-- Categorias pessoais detalhadas + lançamentos anteriores à implantação + dashboard mensal.

ALTER TABLE transactions ADD COLUMN opening_history INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO settings(key, value) VALUES
  ('opening_snapshot_date', '2026-08-10'),
  ('opening_history_start_date', '2026-08-01');

-- Categoria operacional adicional.
INSERT INTO categories(name,nature)
SELECT 'Combustível empresa','business_operating'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Combustível empresa' AND nature='business_operating');

-- Categorias pessoais para refletir os gastos reais informados pelo usuário.
INSERT INTO categories(name,nature)
SELECT 'Mercado pessoal','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Mercado pessoal' AND nature='personal_withdrawal');
INSERT INTO categories(name,nature)
SELECT 'Combustível pessoal','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Combustível pessoal' AND nature='personal_withdrawal');
INSERT INTO categories(name,nature)
SELECT 'Marmita','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Marmita' AND nature='personal_withdrawal');
INSERT INTO categories(name,nature)
SELECT 'Lanche','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Lanche' AND nature='personal_withdrawal');
INSERT INTO categories(name,nature)
SELECT 'Saúde e farmácia','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Saúde e farmácia' AND nature='personal_withdrawal');
INSERT INTO categories(name,nature)
SELECT 'Outros pessoais','personal_withdrawal'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Outros pessoais' AND nature='personal_withdrawal');

-- Categorias úteis para receitas/faturamento da empresa.
INSERT INTO categories(name,nature)
SELECT 'Vendas da loja','income'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Vendas da loja' AND nature='income');
INSERT INTO categories(name,nature)
SELECT 'Outras entradas','income'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Outras entradas' AND nature='income');

-- Marca os lançamentos de implantação já existentes como histórico anterior ao saldo inicial.
UPDATE transactions
SET opening_history=1
WHERE source_account_id IS NULL
  AND destination_account_id IS NULL
  AND period_key='2026-08'
  AND (description LIKE '%antes da implantação%' OR description LIKE '%pagamento anterior à implantação%');
