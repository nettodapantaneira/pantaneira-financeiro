PRAGMA foreign_keys = ON;

ALTER TABLE purchases ADD COLUMN nature TEXT NOT NULL DEFAULT 'inventory';
ALTER TABLE purchases ADD COLUMN category_id INTEGER REFERENCES categories(id);

-- Categorias operacionais adicionais: base profissional, sem limitar o usuário a esta lista.
INSERT OR IGNORE INTO categories(name,nature) VALUES
  ('Água mineral e consumo da loja','business_operating'),
  ('Produtos de limpeza','business_operating'),
  ('Material de expediente','business_operating'),
  ('Embalagens e materiais de apoio','business_operating'),
  ('Manutenção e reparos','business_operating'),
  ('Combustível empresa','business_operating'),
  ('Alimentação da equipe','business_operating'),
  ('Fretes e entregas','business_operating'),
  ('Taxas bancárias e maquininhas','business_operating'),
  ('Marketing e publicidade','business_operating'),
  ('Serviços de terceiros','business_operating'),
  ('Telefone e comunicação','business_operating'),
  ('Seguros','business_operating'),
  ('Tarifas e juros','business_operating'),
  ('Outros operacionais','business_operating'),
  ('Mercadoria para revenda','inventory'),
  ('Insumos e matéria-prima','inventory'),
  ('Materiais para personalização','inventory'),
  ('Frete de compra','inventory'),
  ('Outras compras','inventory'),
  ('Mercado pessoal','personal_withdrawal'),
  ('Marmita','personal_withdrawal'),
  ('Lanche','personal_withdrawal'),
  ('Combustível pessoal','personal_withdrawal'),
  ('Saúde e farmácia','personal_withdrawal'),
  ('Educação','personal_withdrawal'),
  ('Vestuário','personal_withdrawal'),
  ('Outros pessoais','personal_withdrawal'),
  ('Outras entradas','income');
