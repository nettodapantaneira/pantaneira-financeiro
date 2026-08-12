PRAGMA foreign_keys = ON;

-- Separa venda atual de recebimento de venda realizada anteriormente.
INSERT OR IGNORE INTO categories(name,nature)
VALUES ('Recebimento de vendas anteriores','income');
