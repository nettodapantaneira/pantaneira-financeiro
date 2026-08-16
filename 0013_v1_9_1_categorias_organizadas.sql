PRAGMA foreign_keys = ON;

-- Pantaneira Financeiro v1.9.1
-- Organização profissional das categorias sem perder o histórico.
-- Também arquiva duplicatas exatas e categorias legadas que não devem
-- continuar aparecendo para novos lançamentos.

-- 1) Deduplicação exata por nome + natureza, independentemente do parent_id.
DROP TABLE IF EXISTS _v191_cat_map;
CREATE TEMP TABLE _v191_cat_map AS
SELECT c.id old_id,
       (
         SELECT MIN(c2.id)
         FROM categories c2
         WHERE lower(trim(c2.name))=lower(trim(c.name))
           AND c2.nature=c.nature
       ) new_id
FROM categories c
WHERE c.id <> (
  SELECT MIN(c2.id)
  FROM categories c2
  WHERE lower(trim(c2.name))=lower(trim(c.name))
    AND c2.nature=c.nature
);

UPDATE transactions
SET category_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=transactions.category_id)
WHERE category_id IN (SELECT old_id FROM _v191_cat_map);

UPDATE obligations
SET category_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=obligations.category_id)
WHERE category_id IN (SELECT old_id FROM _v191_cat_map);

UPDATE expense_templates
SET category_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=expense_templates.category_id)
WHERE category_id IN (SELECT old_id FROM _v191_cat_map);

UPDATE purchases
SET category_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=purchases.category_id)
WHERE category_id IN (SELECT old_id FROM _v191_cat_map);

UPDATE credit_card_items
SET category_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=credit_card_items.category_id)
WHERE category_id IN (SELECT old_id FROM _v191_cat_map);

-- Renomeia/arquiva as duplicatas antes de ajustar pais, evitando colisões
-- com o índice único de categorias.
UPDATE categories
SET name=name || ' · duplicada arquivada #' || id,
    active=0
WHERE id IN (SELECT old_id FROM _v191_cat_map);

UPDATE categories
SET parent_id=(SELECT new_id FROM _v191_cat_map m WHERE m.old_id=categories.parent_id)
WHERE parent_id IN (SELECT old_id FROM _v191_cat_map)
  AND id NOT IN (SELECT old_id FROM _v191_cat_map);

-- 2) Consolida a duplicidade semântica Receita de vendas -> Vendas da loja.
INSERT OR IGNORE INTO categories(name,nature)
VALUES ('Vendas da loja','income');

UPDATE transactions
SET category_id=(SELECT id FROM categories WHERE name='Vendas da loja' AND nature='income' ORDER BY id LIMIT 1)
WHERE category_id IN (
  SELECT id FROM categories WHERE name='Receita de vendas' AND nature='income'
);

UPDATE obligations
SET category_id=(SELECT id FROM categories WHERE name='Vendas da loja' AND nature='income' ORDER BY id LIMIT 1)
WHERE category_id IN (
  SELECT id FROM categories WHERE name='Receita de vendas' AND nature='income'
);

UPDATE categories
SET name='Receita de vendas · legado',
    active=0
WHERE name='Receita de vendas' AND nature='income';

-- 3) Acordos pessoais é uma categoria legada do modelo antigo.
-- Reclassifica somente o que claramente pertence ao acordo societário.
INSERT OR IGNORE INTO categories(name,nature)
VALUES ('Aquisição de participação societária','business_debt');

UPDATE transactions
SET nature='business_debt',
    category_id=(SELECT id FROM categories
                 WHERE name='Aquisição de participação societária'
                   AND nature='business_debt'
                 ORDER BY id LIMIT 1)
WHERE category_id IN (
    SELECT id FROM categories
    WHERE name='Acordos pessoais' AND nature='personal_withdrawal'
  )
  AND (
    debt_id IN (
      SELECT id FROM debts
      WHERE lower(name) LIKE '%acordo societ%'
         OR lower(name) LIKE '%participa%'
    )
    OR lower(description) LIKE '%acordo%'
    OR lower(description) LIKE '%elaine%'
  );

UPDATE credit_card_items
SET nature='business_debt',
    scope='business',
    category_id=(SELECT id FROM categories
                 WHERE name='Aquisição de participação societária'
                   AND nature='business_debt'
                 ORDER BY id LIMIT 1)
WHERE category_id IN (
    SELECT id FROM categories
    WHERE name='Acordos pessoais' AND nature='personal_withdrawal'
  )
  AND lower(description) LIKE '%acordo%';

UPDATE categories
SET name='Acordos pessoais · legado',
    active=0
WHERE name='Acordos pessoais' AND nature='personal_withdrawal';

-- 4) Cria os grupos principais.
INSERT OR IGNORE INTO categories(name,nature) VALUES
  ('Estrutura e ocupação','business_operating'),
  ('Equipe e administração','business_operating'),
  ('Operação da loja','business_operating'),
  ('Marketing e vendas','business_operating'),
  ('Financeiro e taxas','business_operating'),
  ('Manutenção e serviços','business_operating'),

  ('Compras e estoque','inventory'),

  ('Casa e moradia','personal_withdrawal'),
  ('Alimentação pessoal','personal_withdrawal'),
  ('Mobilidade e viagens','personal_withdrawal'),
  ('Família e compromissos','personal_withdrawal'),
  ('Saúde e desenvolvimento','personal_withdrawal'),
  ('Compras e lazer','personal_withdrawal'),
  ('Pets','personal_withdrawal'),

  ('Receitas','income'),

  ('Acordos e financiamentos','business_debt');

-- 5) Empresa · operação.
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Estrutura e ocupação' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN (
  'Aluguel e ocupação','Energia','Internet','Telefone e comunicação','Seguros'
);

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Equipe e administração' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN (
  'Funcionários','Contabilidade','Impostos correntes','Sistemas e aplicativos',
  'Material de expediente','Água mineral e consumo da loja',
  'Produtos de limpeza','Alimentação da equipe'
);

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Operação da loja' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN (
  'Embalagens e materiais de apoio','Combustível empresa',
  'Fretes e entregas','Outros operacionais'
);

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Marketing e vendas' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN ('Marketing e publicidade');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Financeiro e taxas' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN (
  'Taxas bancárias e maquininhas','Tarifas e juros'
);

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Manutenção e serviços' AND nature='business_operating' ORDER BY id LIMIT 1)
WHERE nature='business_operating' AND name IN (
  'Manutenção e reparos','Serviços de terceiros'
);

-- 6) Compras / estoque.
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Compras e estoque' AND nature='inventory' ORDER BY id LIMIT 1)
WHERE nature='inventory'
  AND name IN (
    'Mercadoria para revenda','Insumos e matéria-prima',
    'Materiais para personalização','Frete de compra','Outras compras'
  )
  AND name<>'Compras e estoque';

-- 7) Pessoal.
-- Remove um nível desnecessário de subcategoria em itens que estavam abaixo de Mercado pessoal.
UPDATE categories
SET parent_id=(SELECT id FROM categories WHERE name='Alimentação pessoal' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND parent_id IN (
    SELECT id FROM categories WHERE name='Mercado pessoal' AND nature='personal_withdrawal'
  );

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Casa e moradia' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Moradia','Casa e decoração');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Alimentação pessoal' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Alimentação','Mercado pessoal','Marmita','Lanche');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Mobilidade e viagens' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Combustível pessoal','Transporte','Viagem');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Família e compromissos' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Família e pensão','Doações');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Saúde e desenvolvimento' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Saúde e farmácia','Educação');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Compras e lazer' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Vestuário','Lazer e compras','Outros pessoais');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Pets' AND nature='personal_withdrawal' ORDER BY id LIMIT 1)
WHERE nature='personal_withdrawal'
  AND name IN ('Veterinário / medicamentos','Veterinário e medicamentos')
  AND name<>'Pets';

-- 8) Receitas.
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Receitas' AND nature='income' ORDER BY id LIMIT 1)
WHERE nature='income'
  AND name IN (
    'Vendas da loja','Outras entradas',
    'Recebimento de vendas anteriores','Rendimentos financeiros'
  );

-- 9) Acordos e financiamentos.
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE name='Acordos e financiamentos' AND nature='business_debt' ORDER BY id LIMIT 1)
WHERE nature='business_debt'
  AND name IN (
    'Empréstimos e acordos',
    'Aquisição de participação societária',
    'Pagamento de fatura de cartão'
  );

INSERT OR REPLACE INTO settings(key,value)
VALUES ('category_taxonomy_version','1.9.1');

DROP TABLE IF EXISTS _v191_cat_map;
