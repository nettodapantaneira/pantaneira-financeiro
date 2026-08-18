import worker193 from './worker-v193.js';

const VERSION = '1.9.4';
const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        return handleFinanceCommandV194(request, env, ctx);
      }

      const res = await worker193.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, res.status);
      }

      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('text/html')) {
        let html = await res.text();

        if (!html.includes('/v194.js')) {
          html = html.replace(
            '</body>',
            `<script src="/v194.js?v=${VERSION}"></script></body>`
          );
        }

        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control', 'no-cache');

        return new Response(html, {
          status: res.status,
          headers
        });
      }

      return res;
    } catch (error) {
      console.error('v1.9.4', error);

      if (url.pathname.startsWith('/api/')) {
        return json(
          { error: String(error?.message || error) },
          400
        );
      }

      return worker193.fetch(request, env, ctx);
    }
  }
};

async function handleFinanceCommandV194(request, env, ctx) {
  const body = await request.clone().json().catch(() => null);

  if (!body || typeof body.text !== 'string') {
    return worker193.fetch(request, env, ctx);
  }

  let text = String(body.text || '').trim();
  if (!text) {
    return worker193.fetch(request, env, ctx);
  }

  /*
   * REGRA MERCADO PAGO
   *
   * Crédito e débito do PDV são faturamento bruto.
   * O saldo bancário do Mercado Pago só deve receber a LIBERAÇÃO LÍQUIDA
   * que realmente apareceu no extrato.
   *
   * Assim evitamos:
   * venda bruta - taxa + liberação líquida = duplicidade.
   */
  if (isGrossMercadoPagoCardSale(text)) {
    return json({
      ok: false,
      error: 'Venda bruta de cartão não deve movimentar a conta Mercado Pago.',
      reply:
        'Não registrei este valor no banco.\n\n' +
        'Crédito/débito do PDV é faturamento bruto. ' +
        'No Mercado Pago registre somente o valor líquido quando ele for liberado no extrato.\n\n' +
        'Exemplo: entrou 180,38 liberacao mercado pago'
    }, 400);
  }

  /*
   * Linguagem natural:
   * "paguei 38 acordo pix nubank" => acordo societário.
   * Mantém frases já específicas sem alteração.
   */
  text = normalizeAgreementAlias(text);

  /*
   * Data retroativa para ENTRADA/SAÍDA após a implantação.
   *
   * O worker base aceita o prefixo, mas hoje bloqueia datas posteriores
   * ao período histórico quando não são a data atual.
   *
   * Estratégia segura:
   * 1) processa o comando normalmente sem o prefixo;
   * 2) captura o ID criado;
   * 3) muda apenas occurred_at/period_key para a data informada;
   * 4) registra revision de auditoria.
   *
   * Compras no cartão continuam com o fluxo próprio da v1.8.2, que já
   * aceita data da compra e não movimenta o saldo bancário.
   */
  const dateInfo = extractDatePrefix(text);

  if (dateInfo && isOrdinaryIncomeExpense(dateInfo.rest) && !isMercadoPagoCardPurchase(dateInfo.rest)) {
    const today = localDate();
    const historicalEnd = '2026-08-10';

    if (dateInfo.iso > today) {
      return json({
        ok: false,
        error: 'A data não pode estar no futuro.',
        reply: 'Não registrei: a data informada está no futuro.'
      }, 400);
    }

    if (dateInfo.iso > historicalEnd && dateInfo.iso !== today) {
      const forwarded = makeJsonRequest(request, {
        ...body,
        text: dateInfo.rest
      });

      const res = await worker193.fetch(forwarded, env, ctx);

      if (!res.ok) return res;

      const data = await res.clone().json().catch(() => null);
      const id = transactionIdFromReply(data?.reply);

      if (!id) {
        return res;
      }

      const current = await env.DB.prepare(
        "SELECT * FROM transactions WHERE id=? AND status!='void' LIMIT 1"
      ).bind(id).first();

      if (!current) return res;

      const occurredAt = `${dateInfo.iso}T16:00:00.000Z`;
      const periodKey = dateInfo.iso.slice(0, 7);

      await env.DB.prepare(
        "UPDATE transactions SET occurred_at=?,period_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(occurredAt, periodKey, id).run();

      const after = await env.DB.prepare(
        "SELECT * FROM transactions WHERE id=? LIMIT 1"
      ).bind(id).first();

      await env.DB.prepare(`
        INSERT INTO transaction_revisions(
          transaction_id,action,before_json,after_json
        ) VALUES(?,?,?,?)
      `).bind(
        id,
        'edit',
        JSON.stringify(current),
        JSON.stringify(after)
      ).run().catch(() => {});

      if (data?.reply) {
        data.reply = replaceOrAppendDate(data.reply, dateInfo.iso);
        data.reply += '\nData retroativa aplicada pela v1.9.4.';
        return json(data, res.status);
      }

      return res;
    }
  }

  const forwarded = makeJsonRequest(request, {
    ...body,
    text
  });

  const res = await worker193.fetch(forwarded, env, ctx);

  if (new URL(request.url).pathname === '/api/health' && res.ok) {
    const data = await res.clone().json().catch(() => ({}));
    return json({ ...data, version: VERSION }, res.status);
  }

  return res;
}

function isGrossMercadoPagoCardSale(text) {
  const n = norm(stripDatePrefix(text));

  if (!/^(entrou|recebi|vendi|venda|vendas)\b/.test(n)) return false;
  if (!/\bmercado pago\b/.test(n)) return false;
  if (/\bliberacao\b|\bliberado\b|\bliquido\b/.test(n)) return false;

  return /\bcredito\b|\bdebito\b/.test(n);
}

function isMercadoPagoCardPurchase(text) {
  const n = norm(stripDatePrefix(text));

  if (!/^(compra|comprei|gasto|gastei)\b/.test(n)) return false;
  if (!/\bmercado pago\b/.test(n)) return false;

  return /\bcredito\b|\bcartao\b/.test(n) &&
    /\bpessoal\b|\bempresa\b|\bempresarial\b|\bloja\b|\bestoque\b|\bmercadoria\b|\bmarketing\b/.test(n);
}

function isOrdinaryIncomeExpense(text) {
  const n = norm(text);
  return /^(entrou|recebi|vendi|venda|gasto|gastei|paguei|saida|saiu)\b/.test(n);
}

function normalizeAgreementAlias(text) {
  const info = extractDatePrefix(text);
  const prefix = info ? text.slice(0, text.length - info.rest.length) : '';
  let rest = info ? info.rest : text;
  const n = norm(rest);

  if (!/^(gasto|gastei|paguei|saida|saiu)\b/.test(n)) {
    return text;
  }

  if (
    /\bacordo societario\b/.test(n) ||
    /\baquisicao societaria\b/.test(n) ||
    /\bacordo empresa\b/.test(n)
  ) {
    return text;
  }

  if (/\bacordo\b/.test(n)) {
    rest = rest.replace(/\bacordo\b/i, 'acordo societario');
    return `${prefix}${rest}`.trim();
  }

  return text;
}

function extractDatePrefix(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/);

  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : Number(localDate().slice(0, 4));

  if (year < 100) year += 2000;

  const iso =
    `${String(year).padStart(4, '0')}-` +
    `${String(month).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}`;

  if (!validIsoDate(iso)) return null;

  return {
    iso,
    rest: raw.slice(m[0].length).trim()
  };
}

function stripDatePrefix(text) {
  return extractDatePrefix(text)?.rest || String(text || '').trim();
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));

  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function transactionIdFromReply(reply) {
  const m = String(reply || '').match(/\bID\s*#(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

function replaceOrAppendDate(reply, iso) {
  const br = iso.split('-').reverse().join('/');
  const s = String(reply || '');

  if (/^Data:\s*.+$/mi.test(s)) {
    return s.replace(/^Data:\s*.+$/mi, `Data: ${br}`);
  }

  const idMatch = s.match(/\nID\s*#\d+/i);

  if (idMatch) {
    return s.replace(idMatch[0], `\nData: ${br}${idMatch[0]}`);
  }

  return `${s}\nData: ${br}`;
}

function makeJsonRequest(request, body) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
