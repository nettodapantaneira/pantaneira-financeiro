# Pantaneira Financeiro v1.0.0

MVP financeiro independente para controle diário da Pantaneira.

## O que já existe
- PWA mobile-first.
- Login protegido por `APP_PASSWORD` + cookie assinado com `SESSION_SECRET`.
- Cloudflare Worker + D1.
- Tela Hoje: saldo empresarial, comprometido, livre de verdade e proteção diária.
- Contas/obrigações e reservas virtuais.
- Dívidas.
- Lançamentos com natureza + origem do dinheiro.
- Retirada pessoal separada da operação da empresa.
- Caixa em dinheiro com conferência e diferença não identificada.
- Carga inicial com os valores informados até 10/08/2026.

## Implantação

1. Instale Node.js 20+ e, dentro da pasta, execute `npm install`.
2. Autentique o Wrangler: `npx wrangler login`.
3. Crie o D1: `npx wrangler d1 create pantaneira-financeiro-db`.
4. Copie o `database_id` retornado e substitua o UUID `00000000-0000-0000-0000-000000000000` em `wrangler.jsonc`.
5. Aplique a migration remota: `npm run db:migrate:remote`.
6. Crie os segredos:
   - `npx wrangler secret put APP_PASSWORD`
   - `npx wrangler secret put SESSION_SECRET`
7. Publique: `npm run deploy`.
8. No Cloudflare, associe o domínio `financeiro.pantaneiraterere.com.br` ao Worker.
9. No primeiro acesso, vá em **Caixa > Saldos iniciais** e informe o saldo real da conta da Pantaneira e do dinheiro físico.

## Desenvolvimento local
- Copie `.dev.vars.example` para `.dev.vars` e altere os valores.
- `npm run db:migrate:local`
- `npm run dev`

## Regra de negócio central
O saldo bancário não é o dinheiro livre. O app calcula o dinheiro livre descontando os compromissos rígidos ainda não reservados e calcula quanto precisa ser protegido por dia.

Para contas com vencimento conhecido, a meta diária usa o valor ainda não reservado dividido pelos dias úteis (segunda a sábado) até o vencimento. Para obrigações sem vencimento conhecido, usa a referência mensal dividida por 25 dias até que o vencimento seja cadastrado.
