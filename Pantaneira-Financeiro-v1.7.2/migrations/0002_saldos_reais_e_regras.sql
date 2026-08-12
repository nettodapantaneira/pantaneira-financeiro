PRAGMA foreign_keys = ON;

-- Diferencia dinheiro disponível de valores que ainda não podem ser usados (ex.: cheque em mãos).
ALTER TABLE accounts ADD COLUMN available_for_spending INTEGER NOT NULL DEFAULT 1;

-- Fotografia inicial informada em 10/08/2026.
UPDATE accounts
SET name='Mercado Pago',
    opening_balance_cents=166781,
    available_for_spending=1,
    notes='Saldo inicial real informado em 10/08/2026.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Conta da Pantaneira';

UPDATE accounts
SET opening_balance_cents=18400,
    available_for_spending=1,
    notes='Dinheiro físico em mãos informado em 10/08/2026. Deve ser conferido periodicamente.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Dinheiro físico' AND owner_scope='business';

INSERT INTO accounts(name, owner_scope, account_type, opening_balance_cents, available_for_spending, notes)
SELECT 'Nubank', 'business', 'bank', 56101, 1, 'Saldo inicial real informado em 10/08/2026.'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name='Nubank' AND owner_scope='business');

INSERT INTO accounts(name, owner_scope, account_type, opening_balance_cents, available_for_spending, notes)
SELECT 'Cheque em mãos', 'business', 'other', 49002, 0, 'Cheque físico em mãos. Não entra no PODE USAR enquanto não for compensado; transfira para a conta de destino quando compensar.'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name='Cheque em mãos' AND owner_scope='business');

-- Energia solar: manter cadastro, mas sem gerar compromisso/meta automática.
UPDATE obligations
SET monthly_target_cents=0,
    counts_in_daily_target=0,
    notes='Energia solar. Valor padrão R$ 0,00; registrar somente eventual cobrança real no mês.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Energia loja';

-- Compras/estoque não têm orçamento mensal automático. Registrar apenas quando ocorrerem.
UPDATE obligations
SET monthly_target_cents=0,
    counts_in_daily_target=0,
    active=0,
    notes='Orçamento automático removido. Compras de mercadoria são registradas somente quando ocorrerem, normalmente à vista.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Orçamento compras/estoque';

-- R$ 1.000 de funcionários já pagos antes da fotografia dos saldos atuais.
-- O lançamento reduz o compromisso do mês, mas não movimenta nenhuma conta para não descontar o valor duas vezes.
INSERT INTO transactions(
  occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,
  nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status
)
SELECT
  '2026-08-01T12:00:00.000Z','2026-08','expense',100000,NULL,NULL,
  'business_operating',c.id,o.id,NULL,
  'Funcionários - pagamento anterior à implantação',
  'R$ 1.000,00 já pagos em agosto antes da fotografia dos saldos iniciais. Não movimenta conta para evitar desconto em duplicidade.',
  'other','eventual','posted'
FROM obligations o
LEFT JOIN categories c ON c.id=o.category_id
WHERE o.name='Funcionários'
  AND NOT EXISTS (
    SELECT 1 FROM transactions
    WHERE description='Funcionários - pagamento anterior à implantação'
      AND period_key='2026-08'
  );
