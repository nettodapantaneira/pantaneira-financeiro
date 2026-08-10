PRAGMA foreign_keys = ON;

-- Pantaneira Financeiro v1.1.0
-- Consolidação das regras reais levantadas com o usuário.

INSERT OR REPLACE INTO settings(key, value) VALUES
  ('personal_fixed_ceiling_cents', '291800'),
  ('personal_ceiling_mode', 'reference_not_reserve'),
  ('inventory_budget_mode', 'on_demand'),
  ('old_debt_mode', 'pay_when_possible');

-- Metadados adicionais para obrigações e dívidas.
ALTER TABLE obligations ADD COLUMN due_date TEXT;
ALTER TABLE obligations ADD COLUMN personal_ceiling_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE debts ADD COLUMN debt_kind TEXT NOT NULL DEFAULT 'old';

-- Fornecedores e compras passam a ter controle próprio.
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK(total_cents > 0),
  paid_now_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_now_cents >= 0),
  payable_cents INTEGER NOT NULL DEFAULT 0 CHECK(payable_cents >= 0),
  source_account_id INTEGER REFERENCES accounts(id),
  payment_method TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  transaction_id INTEGER REFERENCES transactions(id),
  obligation_id INTEGER REFERENCES obligations(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE transactions ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE transactions ADD COLUMN purchase_id INTEGER REFERENCES purchases(id);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON transactions(supplier_id);

-- Saldos reais informados para início de operação em 10/08/2026.
UPDATE accounts
SET name='Mercado Pago', opening_balance_cents=166781, available_for_spending=1,
    notes='Saldo inicial real informado em 10/08/2026.', updated_at=CURRENT_TIMESTAMP
WHERE name IN ('Conta da Pantaneira','Mercado Pago') AND owner_scope='business' AND account_type='bank';

INSERT INTO accounts(name, owner_scope, account_type, opening_balance_cents, available_for_spending, notes)
SELECT 'Nubank','business','bank',56101,1,'Saldo inicial real informado em 10/08/2026.'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name='Nubank' AND owner_scope='business');

UPDATE accounts
SET opening_balance_cents=56101, available_for_spending=1,
    notes='Saldo inicial real informado em 10/08/2026.', updated_at=CURRENT_TIMESTAMP
WHERE name='Nubank' AND owner_scope='business';

UPDATE accounts
SET opening_balance_cents=18400, available_for_spending=1,
    notes='Dinheiro físico em mãos informado em 10/08/2026. Deve ser conferido periodicamente.', updated_at=CURRENT_TIMESTAMP
WHERE name='Dinheiro físico' AND owner_scope='business';

INSERT INTO accounts(name, owner_scope, account_type, opening_balance_cents, available_for_spending, notes)
SELECT 'Cheque em mãos','business','other',49002,0,'Cheque físico em mãos. Só entra no PODE USAR após compensação.'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name='Cheque em mãos' AND owner_scope='business');

UPDATE accounts
SET opening_balance_cents=49002, available_for_spending=0,
    notes='Cheque físico em mãos. Só entra no PODE USAR após compensação.', updated_at=CURRENT_TIMESTAMP
WHERE name='Cheque em mãos' AND owner_scope='business';

-- Energia solar: manter cadastro sem compromisso mensal automático.
UPDATE obligations
SET monthly_target_cents=0, counts_in_daily_target=0,
    notes='Energia solar. Valor padrão R$ 0,00; registrar cobrança apenas quando existir.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Energia loja';

-- Compras são feitas conforme houver caixa, por compra e fornecedor.
UPDATE obligations
SET monthly_target_cents=0, counts_in_daily_target=0, active=0,
    notes='Orçamento mensal removido. Compras são registradas individualmente por fornecedor.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Orçamento compras/estoque';

-- Custos pessoais fixos formam teto de referência, mas não reserva automática.
UPDATE obligations
SET counts_in_daily_target=0, personal_ceiling_member=1,
    notes=CASE name
      WHEN 'Pensão' THEN 'Obrigação pessoal prioritária. Pode ser paga/retirada em partes; compõe o teto pessoal, sem reserva diária automática.'
      ELSE 'Custo pessoal fixo. Compõe o teto pessoal mensal, sem retirada ou reserva automática.'
    END,
    priority=CASE WHEN name='Pensão' THEN 1 ELSE 4 END,
    updated_at=CURRENT_TIMESTAMP
WHERE name IN ('Aluguel casa','Internet casa','Água casa','Pensão');

-- Acordo da participação da ex fica como dívida pessoal antiga/flexível, fora do teto fixo.
UPDATE debts
SET monthly_target_cents=NULL, installment_cents=NULL, flexible=1, debt_kind='personal_agreement',
    notes='Compra da participação da ex. Pagar conforme houver disponibilidade; fora do teto fixo pessoal.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Compra da participação da ex';

UPDATE obligations
SET counts_in_daily_target=0, active=0,
    notes='Desativado como obrigação mensal. Acordo controlado em Dívidas antigas e pago conforme disponibilidade.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Acordo participação ex';

-- Chico Dal Magro: dívida antiga separada das compras correntes e sem meta mensal obrigatória.
UPDATE debts
SET monthly_target_cents=NULL, installment_cents=NULL, flexible=1, debt_kind='old',
    notes='Dívida antiga separada das compras novas. Saldo inicial R$ 85.000; pagar conforme houver caixa e informar cada pagamento.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Dívida Chico Dal Magro';

UPDATE obligations
SET counts_in_daily_target=0, active=0,
    notes='Desativado como parcela mensal. A dívida antiga é paga conforme houver caixa.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Pagamento Chico Dal Magro';

-- Acerto funcionário é dívida antiga sem parcela fixa.
UPDATE debts
SET monthly_target_cents=NULL, installment_cents=NULL, flexible=1, debt_kind='old',
    notes='Dívida antiga. Pagar conforme houver caixa e informar cada pagamento.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Acerto funcionário';

-- Banco X permanece como obrigação corrente enquanto houver parcela mensal informada.
UPDATE debts SET debt_kind='current_installment' WHERE name='Empréstimo Banco X';

-- Pagamento de R$ 1.000 de funcionários já ocorreu antes da fotografia inicial dos saldos.
INSERT INTO transactions(
  occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,
  nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status
)
SELECT
  '2026-08-01T12:00:00.000Z','2026-08','expense',100000,NULL,NULL,
  'business_operating',c.id,o.id,NULL,
  'Funcionários - pagamento anterior à implantação',
  'R$ 1.000,00 pagos antes da fotografia inicial. Não movimenta conta para evitar desconto em duplicidade.',
  'other','eventual','posted'
FROM obligations o
LEFT JOIN categories c ON c.id=o.category_id
WHERE o.name='Funcionários'
  AND NOT EXISTS (
    SELECT 1 FROM transactions
    WHERE description='Funcionários - pagamento anterior à implantação' AND period_key='2026-08'
  );

-- Fornecedor inicial conhecido.
INSERT INTO suppliers(name, notes)
SELECT 'Chico Dal Magro','Fornecedor recorrente. Compras novas não se misturam com a dívida antiga.'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name='Chico Dal Magro');

-- Doações são referência variável, não obrigação mensal.
UPDATE obligations
SET active=0, counts_in_daily_target=0,
    notes='Doação é gasto pessoal variável. Registrar somente quando ocorrer; referência histórica aproximada R$ 259/mês.',
    updated_at=CURRENT_TIMESTAMP
WHERE name='Doações';
