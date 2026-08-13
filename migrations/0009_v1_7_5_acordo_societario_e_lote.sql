PRAGMA foreign_keys = ON;

-- v1.7.5 — corrige a natureza do acordo societário e remove identificação pessoal dos cadastros visíveis.
INSERT OR IGNORE INTO categories(name,nature)
VALUES ('Aquisição de participação societária','business_debt');

-- Reaproveita o cadastro antigo, sem criar uma segunda dívida quando a base veio das versões anteriores.
UPDATE debts
SET name='Acordo societário',
    creditor=NULL,
    scope='business',
    original_balance_cents=COALESCE(original_balance_cents,300000),
    current_balance_cents=CASE
      WHEN current_balance_cents IS NULL THEN MAX(0,300000-COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.debt_id=debts.id AND t.direction='expense' AND t.status!='void'),0))
      ELSE current_balance_cents
    END,
    monthly_target_cents=NULL,
    installment_cents=NULL,
    due_day=NULL,
    flexible=1,
    priority=5,
    debt_kind='old',
    notes='Obrigação empresarial referente à aquisição de participação societária. Pagamento conforme disponibilidade; sem parcela mensal fixa.',
    updated_at=CURRENT_TIMESTAMP
WHERE name IN ('Compra da participação da ex','Acordo societário');

INSERT INTO debts(name,creditor,scope,original_balance_cents,current_balance_cents,monthly_target_cents,installment_cents,due_day,flexible,priority,status,notes,debt_kind)
SELECT 'Acordo societário',NULL,'business',300000,300000,NULL,NULL,NULL,1,5,'active',
       'Obrigação empresarial referente à aquisição de participação societária. Pagamento conforme disponibilidade; sem parcela mensal fixa.','old'
WHERE NOT EXISTS (SELECT 1 FROM debts WHERE name='Acordo societário');

-- Se algum pagamento antigo já estava explicitamente vinculado a essa dívida, a natureza também passa a ser empresarial.
UPDATE transactions
SET nature='business_debt',
    category_id=(SELECT id FROM categories WHERE name='Aquisição de participação societária' AND nature='business_debt' LIMIT 1),
    obligation_id=NULL,
    description='Pagamento de acordo societário',
    updated_at=CURRENT_TIMESTAMP
WHERE debt_id=(SELECT id FROM debts WHERE name='Acordo societário' LIMIT 1)
  AND direction='expense'
  AND status!='void';

-- O compromisso mensal antigo deixa de ser pessoal e permanece desativado: o controle fica no módulo Dívidas.
UPDATE obligations
SET name='Acordo societário',
    scope='business',
    nature='business_debt',
    category_id=(SELECT id FROM categories WHERE name='Aquisição de participação societária' AND nature='business_debt' LIMIT 1),
    debt_id=(SELECT id FROM debts WHERE name='Acordo societário' LIMIT 1),
    monthly_target_cents=0,
    due_day=NULL,
    due_date=NULL,
    recurring=0,
    flexible=1,
    priority=5,
    counts_in_daily_target=0,
    personal_ceiling_member=0,
    active=0,
    notes='Controlado como dívida empresarial flexível, sem reserva mensal automática.',
    updated_at=CURRENT_TIMESTAMP
WHERE name IN ('Acordo participação ex','Acordo societário')
   OR debt_id IN (SELECT id FROM debts WHERE name='Acordo societário');
