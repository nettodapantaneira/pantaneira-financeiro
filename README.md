# Pantaneira Financeiro v1.1.0

Versão consolidada do controle financeiro da Pantaneira.

## Objetivo

Responder diariamente:

- quanto existe disponível agora;
- quanto está comprometido com contas já assumidas;
- quanto precisa ser protegido hoje;
- quanto pode realmente ser usado;
- quanto foi retirado para despesas pessoais;
- quanto resta dentro do teto pessoal fixo;
- quanto existe em dinheiro físico;
- quanto falta nas dívidas antigas;
- quanto foi comprado por fornecedor.

## Regras consolidadas

- Mercado Pago, Nubank, dinheiro físico e cheque em mãos são controlados separadamente.
- Cheque em mãos não entra em `PODE USAR` até ser compensado.
- Energia da loja permanece cadastrada com valor padrão R$ 0,00 por uso de energia solar.
- Compras não possuem orçamento mensal fixo: são registradas por compra e fornecedor quando acontecerem.
- Compra à vista reduz o caixa imediatamente.
- Compra a prazo cria automaticamente uma conta a pagar com vencimento.
- Chico Dal Magro é controlado como dívida antiga, separado de compras novas com o mesmo fornecedor.
- Dívidas antigas não geram meta mensal obrigatória: pagamentos são informados conforme houver caixa.
- O Banco X permanece como parcela corrente enquanto a obrigação de R$ 1.200 estiver válida.
- Custos pessoais fixos formam teto mensal de referência, atualmente R$ 2.918,00: aluguel R$ 1.200, internet R$ 109, água R$ 109 e pensão R$ 1.500.
- Retiradas pessoais são feitas conforme a necessidade. O app alerta quando ultrapassam o teto ou consomem caixa comprometido, mas não bloqueia.
- A pensão é obrigação pessoal prioritária e pode ser paga em partes.
- Acordo da participação da ex é dívida pessoal flexível, fora do teto fixo.
- Dinheiro físico tem conferência e cria diferença não identificada quando o saldo contado não bate.

## Atualização do banco

A migration `0003_v1_1_0_consolidacao.sql` preserva o D1 existente e acrescenta:

- fornecedores;
- compras;
- vencimento exato de compra a prazo;
- classificação de dívidas antigas;
- membros do teto pessoal;
- vínculo de transações com fornecedor e compra.

O deploy já configurado no Cloudflare deve continuar usando:

```bash
npx wrangler d1 migrations apply pantaneira-financeiro-db --remote && npx wrangler deploy
```

## Segurança

Continuar usando `APP_PASSWORD` e `SESSION_SECRET` como Secrets do Cloudflare. Não inserir esses valores no GitHub.

## Domínio planejado

`financeiro.pantaneiraterere.com.br`
