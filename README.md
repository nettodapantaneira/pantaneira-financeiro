# Pantaneira Financeiro v1.0.2

MVP financeiro independente para controle diário da Pantaneira.

## O que já existe
- PWA mobile-first.
- Login protegido por `APP_PASSWORD` + cookie assinado com `SESSION_SECRET`.
- Cloudflare Worker + D1.
- Tela Hoje: disponível imediato, valores a compensar, patrimônio empresarial, comprometido, livre de verdade e proteção diária.
- Contas/obrigações e reservas virtuais.
- Dívidas.
- Lançamentos com natureza + origem do dinheiro.
- Retirada pessoal separada da operação da empresa.
- Caixa em dinheiro com conferência e diferença não identificada.
- Carga inicial com os valores informados até 10/08/2026.
- Contas iniciais: Mercado Pago R$ 1.667,81; Nubank R$ 561,01; dinheiro físico R$ 184,00; cheque em mãos R$ 490,02 (fora do PODE USAR até compensar).
- Energia loja cadastrada com padrão R$ 0,00 por uso de energia solar.
- R$ 1.000,00 de funcionários já pagos em agosto registrados como histórico de implantação, sem descontar novamente dos saldos atuais.
- Sem orçamento automático de compras/estoque: compras entram apenas quando realmente acontecerem.

## Implantação

1. Instale Node.js 20+ e, dentro da pasta, execute `npm install`.
2. Autentique o Wrangler: `npx wrangler login`.
3. Crie o D1: `npx wrangler d1 create pantaneira-financeiro-db`.
4. O `wrangler.jsonc` desta versão já contém o `database_id` do banco `pantaneira-financeiro-db` deste projeto.
5. Aplique a migration remota: `npm run db:migrate:remote`.
6. Crie os segredos:
   - `npx wrangler secret put APP_PASSWORD`
   - `npx wrangler secret put SESSION_SECRET`
7. Publique: `npm run deploy`.
8. No Cloudflare, associe o domínio `financeiro.pantaneiraterere.com.br` ao Worker.
9. Os saldos iniciais reais de 10/08/2026 são aplicados automaticamente pela migration `0002_saldos_reais_e_regras.sql`. Depois, ajuste manualmente apenas quando necessário.

## Desenvolvimento local
- Copie `.dev.vars.example` para `.dev.vars` e altere os valores.
- `npm run db:migrate:local`
- `npm run dev`

## Regra de negócio central
O saldo bancário não é o dinheiro livre. O app calcula o dinheiro livre descontando os compromissos rígidos ainda não reservados e calcula quanto precisa ser protegido por dia.

Para contas com vencimento conhecido, a meta diária usa o valor ainda não reservado dividido pelos dias úteis (segunda a sábado) até o vencimento. Para obrigações sem vencimento conhecido, usa a referência mensal dividida por 25 dias até que o vencimento seja cadastrado.


## Ajuste de implantação

Contas já pagas antes da fotografia inicial devem ser marcadas pelo botão **Já pago antes do app**. O lançamento entra no histórico do mês e reduz o compromisso, mas não movimenta as contas atuais, evitando desconto em duplicidade.

## v1.2.0 — histórico inicial e dashboard
- Nova aba **Antes** para registrar despesas e entradas ocorridas de 01 a 10/08/2026 antes da fotografia dos saldos iniciais. Esses lançamentos entram no histórico e nos relatórios, mas não movimentam novamente Mercado Pago, Nubank, dinheiro físico ou cheque.
- Categorias pessoais adicionadas: Mercado pessoal, Combustível pessoal, Marmita, Lanche, Saúde e farmácia e Outros pessoais.
- Categoria operacional: Combustível empresa.
- Receitas detalhadas com Vendas da loja e Outras entradas.
- Dashboard mensal com Faturamento informado, Pago/Saiu no mês e Entrou - Saiu.
- Contas fixas já pagas antes do app podem ser vinculadas diretamente na aba Antes para reduzir o valor pendente sem descontar o saldo atual novamente.

## v1.2.1 — edição e cancelamento seguro
- Todo lançamento comum e todo lançamento em **Antes do app** ganhou ação **Editar**.
- É possível corrigir data, valor, descrição, natureza, categoria, conta de origem/destino, forma de pagamento e vínculos com compromisso/dívida quando aplicável.
- A correção recalcula automaticamente saldos, contas, teto pessoal e dívidas.
- Lançamentos do período inicial continuam sem movimentar os saldos atuais mesmo quando editados.
- A opção **Cancelar lançamento** tira o item dos cálculos sem apagar o registro; ele permanece visível como CANCELADO.
- Toda edição/cancelamento é registrada em `transaction_revisions` para auditoria.

## v1.3.1 — Categorias administráveis e dashboard de gastos
- Categorias deixam de ser uma lista fechada: criar, editar, desativar e reativar pelo app.
- Suporte a categoria principal/subcategoria.
- Base ampliada para água mineral/consumo da loja, limpeza, expediente, embalagens, manutenção, combustível, alimentação da equipe, fretes, taxas, marketing, serviços, mercado pessoal, marmita, lanche e outros.
- Compra por fornecedor agora informa se é estoque/insumo ou despesa operacional e exige categoria.
- Dashboard mensal com entradas, saídas e análise das saídas por categoria, inspirado no tipo de leitura visual do Mercado Pago.


## v1.3.1
- Drill-down em retiradas pessoais, entradas e saídas.
- Toque/click no gráfico de categorias para abrir os lançamentos que formam cada fatia.
- Detalhes mostram descrição, data, categoria, conta de origem/destino, forma de pagamento, fornecedor/dívida e observações.
- A partir do detalhamento, o lançamento pode ser aberto para edição.


## v1.5.0 — Histórico mensal, conciliação e WhatsApp
- Histórico anterior ampliado para julho/2026 e 01–10/08/2026, sem alterar os saldos atuais.
- Análise mensal com seletor de período (julho/agosto e demais meses lançados).
- Conciliação de saldo das contas bancárias com trilha de auditoria, sem apagar lançamentos.
- Endpoint oficial do WhatsApp Cloud API em `/api/whatsapp/webhook`, com validação de webhook, assinatura `X-Hub-Signature-256`, lista de número autorizado e deduplicação de mensagens.
- Comandos iniciais via WhatsApp: `saldo`, `resumo julho`, entradas e saídas por texto; lançamentos históricos com data (ex.: `05/07 gasto 80 combustivel pessoal dinheiro`).
- Para ativar WhatsApp configure Secrets: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ALLOWED_NUMBER`; opcional `WHATSAPP_GRAPH_VERSION` (padrão v26.0).


## v1.5.0 — redesign de navegação e dashboard
- Navegação inferior reduzida para 5 áreas principais.
- Contas bancárias e conferência de dinheiro reunidas em Contas.
- Histórico acessível por Movimentos.
- Dashboard Hoje reorganizado com saldos por origem e hierarquia visual mais clara.
- Análises mantêm drill-down por categoria e lançamentos.


## v1.6.0 — layout bancário + ponte privada para o bot

- Dashboard desktop inspirado em apps bancários: menu lateral, saldo/extrato, ações rápidas e análise lateral.
- Mobile mantém navegação inferior e o mesmo fluxo funcional.
- Ações rápidas para Entrada, Saída, Compra e Transferência.
- Extrato recente na tela Hoje.
- Análise mensal e saídas por categoria também visíveis na tela Hoje.
- Novo endpoint privado `POST /api/internal/finance-command` para o Worker do chatbot encaminhar comandos do administrador.
- O endpoint exige `FINANCE_BOT_SECRET` e valida o número em `WHATSAPP_ALLOWED_NUMBER`.
- A integração recomendada usa Service Binding do bot para este Worker; o número do administrador não é migrado nem alterado no WhatsApp Business.


## v1.6.1 — correção do interpretador WhatsApp
- Separa conta e forma de pagamento antes de identificar a categoria.
- Corrige conflito entre `Mercado Pago` e a categoria `Mercado pessoal`.
- Reconhece categorias e subcategorias criadas no app por palavras equivalentes no singular/plural.
- Exibe categoria principal → subcategoria na confirmação do WhatsApp.
- Não exige migration nova.


## v1.6.2 — persistência da autorização WhatsApp
- `WHATSAPP_ALLOWED_NUMBER=5566999767860` passou a fazer parte do `wrangler.jsonc`.
- Evita que deploys via GitHub/Wrangler removam a autorização do 7860.
- `FINANCE_BOT_SECRET` continua como Secret no Cloudflare e não é incluído no repositório.
- Mantém a correção v1.6.1 do parser de categorias/contas.
- Não exige migration nova.
