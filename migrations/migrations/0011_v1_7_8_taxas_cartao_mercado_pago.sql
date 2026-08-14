PRAGMA foreign_keys = ON;

-- Pantaneira Financeiro — hotfix v1.7.8
-- Taxas de cartão Mercado Pago:
-- mantém o faturamento bruto da venda e registra a taxa como despesa operacional,
-- reduzindo o saldo real da conta Mercado Pago.

INSERT OR IGNORE INTO categories(name,nature)
VALUES ('Taxas bancárias e maquininhas','business_operating');

CREATE TABLE IF NOT EXISTS card_fee_rules (
  processor TEXT NOT NULL,
  account_name TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('debit','credit')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps > 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (processor,payment_method)
);

INSERT OR REPLACE INTO card_fee_rules(
  processor,account_name,payment_method,rate_bps,active,updated_at
)
VALUES
  ('mercado_pago','Mercado Pago','debit',89,1,CURRENT_TIMESTAMP),
  ('mercado_pago','Mercado Pago','credit',309,1,CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS card_fee_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  fee_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  processor TEXT NOT NULL,
  fee_rate_bps INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_fee_links_active_sale
ON card_fee_links(sale_transaction_id)
WHERE active=1;

CREATE INDEX IF NOT EXISTS idx_card_fee_links_fee
ON card_fee_links(fee_transaction_id);

DROP TRIGGER IF EXISTS trg_mp_card_fee_after_insert;

CREATE TRIGGER trg_mp_card_fee_after_insert
AFTER INSERT ON transactions
WHEN
  NEW.direction='income'
  AND NEW.status='posted'
  AND COALESCE(NEW.opening_history,0)=0
  AND NEW.payment_method IN ('debit','credit')
  AND EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.id=NEW.destination_account_id
      AND lower(trim(a.name))='mercado pago'
      AND a.owner_scope='business'
  )
  AND EXISTS (
    SELECT 1
    FROM categories c
    WHERE c.id=NEW.category_id
      AND c.nature='income'
      AND lower(trim(c.name))='vendas da loja'
  )
BEGIN
  INSERT INTO transactions(
    occurred_at,period_key,direction,amount_cents,
    source_account_id,destination_account_id,nature,category_id,
    obligation_id,debt_id,description,notes,payment_method,
    recurrence_type,status,opening_history
  )
  SELECT
    NEW.occurred_at,
    NEW.period_key,
    'expense',
    MAX(1,CAST(ROUND(NEW.amount_cents * r.rate_bps / 10000.0) AS INTEGER)),
    NEW.destination_account_id,
    NULL,
    'business_operating',
    c.id,
    NULL,
    NULL,
    CASE NEW.payment_method
      WHEN 'debit' THEN 'Taxa Mercado Pago — débito'
      ELSE 'Taxa Mercado Pago — crédito'
    END,
    'Taxa automática vinculada à venda #' || NEW.id ||
      ' · alíquota ' || printf('%.2f',r.rate_bps/100.0) || '%',
    'other',
    'eventual',
    'posted',
    0
  FROM card_fee_rules r
  JOIN categories c
    ON c.name='Taxas bancárias e maquininhas'
   AND c.nature='business_operating'
   AND c.active=1
  WHERE r.processor='mercado_pago'
    AND r.payment_method=NEW.payment_method
    AND r.active=1
    AND lower(trim(r.account_name))='mercado pago'
  LIMIT 1;

  INSERT INTO card_fee_links(
    sale_transaction_id,fee_transaction_id,processor,
    fee_rate_bps,fee_cents,active
  )
  SELECT
    NEW.id,
    last_insert_rowid(),
    r.processor,
    r.rate_bps,
    MAX(1,CAST(ROUND(NEW.amount_cents * r.rate_bps / 10000.0) AS INTEGER)),
    1
  FROM card_fee_rules r
  WHERE r.processor='mercado_pago'
    AND r.payment_method=NEW.payment_method
    AND r.active=1
    AND lower(trim(r.account_name))='mercado pago'
  LIMIT 1;
END;

DROP TRIGGER IF EXISTS trg_mp_card_fee_after_update;

CREATE TRIGGER trg_mp_card_fee_after_update
AFTER UPDATE OF
  occurred_at,period_key,direction,amount_cents,
  destination_account_id,payment_method,category_id,status,opening_history
ON transactions
WHEN
  EXISTS (
    SELECT 1 FROM card_fee_links l
    WHERE l.sale_transaction_id=OLD.id AND l.active=1
  )
  OR (
    NEW.direction='income'
    AND NEW.status='posted'
    AND COALESCE(NEW.opening_history,0)=0
    AND NEW.payment_method IN ('debit','credit')
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id=NEW.destination_account_id
        AND lower(trim(a.name))='mercado pago'
        AND a.owner_scope='business'
    )
    AND EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id=NEW.category_id
        AND c.nature='income'
        AND lower(trim(c.name))='vendas da loja'
    )
  )
BEGIN
  UPDATE transactions
  SET
    status='void',
    notes=COALESCE(notes,'') ||
      ' | Substituída automaticamente após edição/cancelamento da venda #' || OLD.id
  WHERE id IN (
    SELECT fee_transaction_id
    FROM card_fee_links
    WHERE sale_transaction_id=OLD.id AND active=1
  )
  AND status!='void';

  UPDATE card_fee_links
  SET active=0
  WHERE sale_transaction_id=OLD.id AND active=1;

  INSERT INTO transactions(
    occurred_at,period_key,direction,amount_cents,
    source_account_id,destination_account_id,nature,category_id,
    obligation_id,debt_id,description,notes,payment_method,
    recurrence_type,status,opening_history
  )
  SELECT
    NEW.occurred_at,
    NEW.period_key,
    'expense',
    MAX(1,CAST(ROUND(NEW.amount_cents * r.rate_bps / 10000.0) AS INTEGER)),
    NEW.destination_account_id,
    NULL,
    'business_operating',
    c.id,
    NULL,
    NULL,
    CASE NEW.payment_method
      WHEN 'debit' THEN 'Taxa Mercado Pago — débito'
      ELSE 'Taxa Mercado Pago — crédito'
    END,
    'Taxa automática vinculada à venda #' || NEW.id ||
      ' após edição · alíquota ' || printf('%.2f',r.rate_bps/100.0) || '%',
    'other',
    'eventual',
    'posted',
    0
  FROM card_fee_rules r
  JOIN categories c
    ON c.name='Taxas bancárias e maquininhas'
   AND c.nature='business_operating'
   AND c.active=1
  WHERE r.processor='mercado_pago'
    AND r.payment_method=NEW.payment_method
    AND r.active=1
    AND lower(trim(r.account_name))='mercado pago'
    AND NEW.direction='income'
    AND NEW.status='posted'
    AND COALESCE(NEW.opening_history,0)=0
    AND NEW.payment_method IN ('debit','credit')
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id=NEW.destination_account_id
        AND lower(trim(a.name))='mercado pago'
        AND a.owner_scope='business'
    )
    AND EXISTS (
      SELECT 1 FROM categories vc
      WHERE vc.id=NEW.category_id
        AND vc.nature='income'
        AND lower(trim(vc.name))='vendas da loja'
    )
  LIMIT 1;

  INSERT INTO card_fee_links(
    sale_transaction_id,fee_transaction_id,processor,
    fee_rate_bps,fee_cents,active
  )
  SELECT
    NEW.id,
    last_insert_rowid(),
    r.processor,
    r.rate_bps,
    MAX(1,CAST(ROUND(NEW.amount_cents * r.rate_bps / 10000.0) AS INTEGER)),
    1
  FROM card_fee_rules r
  WHERE r.processor='mercado_pago'
    AND r.payment_method=NEW.payment_method
    AND r.active=1
    AND lower(trim(r.account_name))='mercado pago'
    AND NEW.direction='income'
    AND NEW.status='posted'
    AND COALESCE(NEW.opening_history,0)=0
    AND NEW.payment_method IN ('debit','credit')
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id=NEW.destination_account_id
        AND lower(trim(a.name))='mercado pago'
        AND a.owner_scope='business'
    )
    AND EXISTS (
      SELECT 1 FROM categories vc
      WHERE vc.id=NEW.category_id
        AND vc.nature='income'
        AND lower(trim(vc.name))='vendas da loja'
    )
  LIMIT 1;
END;

-- Correção exata das taxas já cobradas nas quatro vendas em cartão de 13/08/2026:
-- 2 x débito R$35,00 => R$0,31 + R$0,31
-- crédito R$70,00 => R$2,16
-- crédito R$105,00 => R$3,25
-- total real do extrato Mercado Pago = R$6,03.
INSERT INTO transactions(
  occurred_at,period_key,direction,amount_cents,
  source_account_id,destination_account_id,nature,category_id,
  obligation_id,debt_id,description,notes,payment_method,
  recurrence_type,status,opening_history
)
SELECT
  '2026-08-13T23:59:00.000Z',
  '2026-08',
  'expense',
  603,
  mp.id,
  NULL,
  'business_operating',
  fee_cat.id,
  NULL,
  NULL,
  'Taxas Mercado Pago — cartões 13/08/2026',
  'Correção v1.7.8 pelos valores reais do extrato: débito R$0,31 + R$0,31; crédito R$2,16 + R$3,25. Total R$6,03.',
  'other',
  'eventual',
  'posted',
  0
FROM accounts mp
JOIN categories fee_cat
  ON fee_cat.name='Taxas bancárias e maquininhas'
 AND fee_cat.nature='business_operating'
 AND fee_cat.active=1
WHERE lower(trim(mp.name))='mercado pago'
  AND mp.owner_scope='business'
  AND (
    SELECT COUNT(*)
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    WHERE t.destination_account_id=mp.id
      AND t.direction='income'
      AND t.status='posted'
      AND COALESCE(t.opening_history,0)=0
      AND t.period_key='2026-08'
      AND date(t.occurred_at)='2026-08-13'
      AND t.payment_method='debit'
      AND t.amount_cents=3500
      AND c.name='Vendas da loja'
      AND c.nature='income'
  ) >= 2
  AND EXISTS (
    SELECT 1
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    WHERE t.destination_account_id=mp.id
      AND t.direction='income'
      AND t.status='posted'
      AND COALESCE(t.opening_history,0)=0
      AND t.period_key='2026-08'
      AND date(t.occurred_at)='2026-08-13'
      AND t.payment_method='credit'
      AND t.amount_cents=7000
      AND c.name='Vendas da loja'
      AND c.nature='income'
  )
  AND EXISTS (
    SELECT 1
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    WHERE t.destination_account_id=mp.id
      AND t.direction='income'
      AND t.status='posted'
      AND COALESCE(t.opening_history,0)=0
      AND t.period_key='2026-08'
      AND date(t.occurred_at)='2026-08-13'
      AND t.payment_method='credit'
      AND t.amount_cents=10500
      AND c.name='Vendas da loja'
      AND c.nature='income'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM transactions x
    WHERE x.source_account_id=mp.id
      AND x.direction='expense'
      AND x.status='posted'
      AND x.period_key='2026-08'
      AND date(x.occurred_at)='2026-08-13'
      AND x.category_id=fee_cat.id
      AND x.amount_cents=603
  )
LIMIT 1;
