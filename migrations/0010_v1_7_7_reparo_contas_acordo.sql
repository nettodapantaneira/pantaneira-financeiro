PRAGMA foreign_keys = ON;

-- v1.7.7 — repara pagamentos do acordo cuja descrição indica Nubank, mas ficaram no Mercado Pago.
INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json)
SELECT t.id,'edit',
       json_object('source_account_id',t.source_account_id,'destination_account_id',t.destination_account_id,'description',t.description,'amount_cents',t.amount_cents),
       json_object('source_account_id',(SELECT id FROM accounts WHERE lower(name)='nubank' LIMIT 1),'destination_account_id',NULL,'description',t.description,'amount_cents',t.amount_cents)
FROM transactions t
WHERE t.direction='expense'
  AND t.status!='void'
  AND COALESCE(t.opening_history,0)=0
  AND lower(t.description) LIKE '%acord%'
  AND lower(t.description) LIKE '%nubank%'
  AND t.source_account_id=(SELECT id FROM accounts WHERE lower(name)='mercado pago' LIMIT 1)
  AND EXISTS (SELECT 1 FROM accounts WHERE lower(name)='nubank');

UPDATE transactions
SET source_account_id=(SELECT id FROM accounts WHERE lower(name)='nubank' LIMIT 1),
    destination_account_id=NULL,
    updated_at=CURRENT_TIMESTAMP
WHERE direction='expense'
  AND status!='void'
  AND COALESCE(opening_history,0)=0
  AND lower(description) LIKE '%acord%'
  AND lower(description) LIKE '%nubank%'
  AND source_account_id=(SELECT id FROM accounts WHERE lower(name)='mercado pago' LIMIT 1)
  AND EXISTS (SELECT 1 FROM accounts WHERE lower(name)='nubank');
