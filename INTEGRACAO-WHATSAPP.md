# Integração privada com o chatbot Pantaneira

## Arquitetura escolhida

O número administrador continua no WhatsApp Business normalmente. O Worker do chatbot, que já recebe o webhook da Meta, intercepta **somente comandos financeiros enviados pelo número autorizado** e encaminha internamente ao Worker `pantaneira-financeiro` por Service Binding.

Fluxo:

`WhatsApp -> pantaneira-bot-whatsapp -> FINANCEIRO_APP (Service Binding) -> D1 do Financeiro -> resposta pelo próprio bot`

Nenhum webhook da Meta precisa ser trocado para o Financeiro.

## Financeiro

Esta versão expõe:

`POST /api/internal/finance-command`

Headers:

- `Content-Type: application/json`
- `X-Finance-Bot-Secret: <mesmo segredo configurado nos dois Workers>`

Body:

```json
{
  "from": "5566XXXXXXXXX",
  "text": "gasto 45 marmita dinheiro",
  "message_id": "wamid..."
}
```

O Worker Financeiro valida:

1. `FINANCE_BOT_SECRET`;
2. o número enviado contra `WHATSAPP_ALLOWED_NUMBER`;
3. o comando financeiro antes de gravar no D1.

## Variáveis/Secrets no Worker Financeiro

- `FINANCE_BOT_SECRET` — Secret
- `WHATSAPP_ALLOWED_NUMBER` — Secret ou variável protegida no painel

Não publicar esses valores no GitHub.

## Binding e Secrets no Worker do chatbot

Criar um **Service Binding**:

- Binding: `FINANCEIRO_APP`
- Service/Worker: `pantaneira-financeiro`

Criar também:

- `FINANCE_ADMIN_NUMBER` — número autorizado em formato internacional, somente dígitos
- `FINANCE_BOT_SECRET` — exatamente o mesmo segredo do Financeiro

## Patch do bot

No `processIncomingMessage`, depois de salvar/atualizar a mensagem e **antes** de continuar para a lógica normal do bot, chamar:

```js
if (await maybeHandleFinanceAdminCommand(message, parsed, contact, conversation, env)) return;
```

Adicionar ao Worker do bot:

```js
async function maybeHandleFinanceAdminCommand(message, parsed, contact, conversation, env) {
  const from = String(message?.from || "").replace(/\D/g, "");
  const admin = String(env.FINANCE_ADMIN_NUMBER || "").replace(/\D/g, "");
  if (!admin || from !== admin) return false;

  const raw = String(parsed?.body || "").trim();
  if (!isFinanceAdminCommand(raw)) return false;

  let command = raw.replace(/^\s*(?:financeiro|fin)\s*[:\-]?\s*/i, "").trim();
  if (!command) command = "ajuda";

  let reply;
  try {
    if (!env.FINANCEIRO_APP || typeof env.FINANCEIRO_APP.fetch !== "function") {
      throw new Error("Binding FINANCEIRO_APP não configurado.");
    }
    if (!String(env.FINANCE_BOT_SECRET || "").trim()) {
      throw new Error("FINANCE_BOT_SECRET não configurado.");
    }

    const response = await env.FINANCEIRO_APP.fetch(new Request(
      "https://financeiro.internal/api/internal/finance-command",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-finance-bot-secret": String(env.FINANCE_BOT_SECRET)
        },
        body: JSON.stringify({
          from,
          text: command,
          message_id: String(message?.id || "")
        })
      }
    ));

    const data = await response.json().catch(() => ({}));
    reply = String(data?.reply || data?.error || `Financeiro respondeu HTTP ${response.status}.`);
  } catch (error) {
    reply = `Financeiro indisponível: ${String(error?.message || error)}`;
  }

  const outbound = await sendTextMessage(contact?.phone || from, reply, env);
  await saveOutboundMessage(conversation.id, outbound, reply, env);
  return true;
}

function isFinanceAdminCommand(value) {
  const text = String(value || "").trim();
  return /^(?:financeiro|fin)\b|^(?:gasto|gastei|paguei|entrou|recebi|vendi|venda|saldo|resumo)\b/i.test(text);
}
```

### Comandos esperados

- `gasto 45 marmita dinheiro`
- `gasto 120 mercado pessoal mercado pago pix`
- `paguei 500 chico nubank pix`
- `entrou 850 vendas mercado pago`
- `05/07 gasto 80 combustivel pessoal dinheiro`
- `saldo`
- `resumo julho`
- `fin ajuda`

Mensagens comuns do administrador como `oi`, `menu` etc. continuam no fluxo normal do bot porque não correspondem a comandos financeiros.
