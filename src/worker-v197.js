import worker194 from './worker-v194.js';
import worker182 from './worker-v182.js';

const VERSION = '1.9.7';
const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname === '/api/internal/finance-command' &&
        request.method === 'POST'
      ) {
        return await routeFinanceCommand(request, env, ctx);
      }

      const response = await worker194.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, response.status);
      }

      const type = response.headers.get('content-type') || '';

      if (
        url.pathname === '/v194.js' &&
        response.ok &&
        type.includes('javascript')
      ) {
        let js = await response.text();
        js = js.replace(
          /const\s+VERSION\s*=\s*['"]1\.9\.\d+['"]\s*;/,
          `const VERSION = '${VERSION}';`
        );

        return new Response(js, {
          status: response.status,
          headers: freshHeaders(response.headers)
        });
      }

      if (response.ok && type.includes('text/html')) {
        return new Response(await response.text(), {
          status: response.status,
          headers: freshHeaders(response.headers)
        });
      }

      return response;
    } catch (error) {
      console.error('Pantaneira Financeiro v1.9.7', error);

      if (url.pathname.startsWith('/api/')) {
        return json(
          { error: String(error?.message || error) },
          400
        );
      }

      // Fallback direto para a base estável. Nunca chama v1.9.6.
      return worker194.fetch(request, env, ctx);
    }
  }
};

async function routeFinanceCommand(request, env, ctx) {
  const body = await request.clone().json().catch(() => null);

  if (!body || typeof body.text !== 'string') {
    return worker194.fetch(request, env, ctx);
  }

  const raw = stripFinancePrefix(body.text);
  const shell = parseCommandShell(raw);

  if (!shell) {
    return worker194.fetch(
      rebuildRequestWithText(request, body, raw),
      env,
      ctx
    );
  }

  const incomeVerbs = new Set([
    'entrou',
    'recebi',
    'vendi',
    'venda'
  ]);

  // ENTRADA/VENDA nunca pode virar compra no cartão.
  if (incomeVerbs.has(shell.verb)) {
    return worker194.fetch(
      rebuildRequestWithText(request, body, raw),
      env,
      ctx
    );
  }

  const expenseVerbs = new Set([
    'gasto',
    'gastei',
    'paguei',
    'saida',
    'saiu',
    'compra',
    'comprei'
  ]);

  if (!expenseVerbs.has(shell.verb)) {
    return worker194.fetch(
      rebuildRequestWithText(request, body, raw),
      env,
      ctx
    );
  }

  const n = norm(shell.rest);
  const mercadoPago = /\bmercado pago\b/.test(n);
  const credito =
    /\bcredito\b/.test(n) ||
    /\bcartao(?: de credito)?\b/.test(n);

  // Pix, débito, dinheiro etc. continuam no fluxo bancário normal.
  if (!mercadoPago || !credito) {
    return worker194.fetch(
      rebuildRequestWithText(request, body, raw),
      env,
      ctx
    );
  }

  // Pagamento de fatura não pode virar uma nova compra.
  if (/\bfatura\b/.test(n)) {
    return json(
      {
        ok: false,
        error:
          'Pagamento de fatura deve ser registrado em Compromissos → Cartões e faturas.',
        reply:
          'Pagamento de fatura identificado. Use Compromissos → Cartões e faturas para não duplicar a despesa.'
      },
      400
    );
  }

  const rewritten = rewriteCardPurchase(shell);

  if (!rewritten.ok) {
    return json(
      {
        ok: false,
        error: rewritten.error,
        reply: rewritten.error
      },
      400
    );
  }

  // Chamada DIRETA ao módulo de cartão. Não passa pela v1.9.6.
  return worker182.fetch(
    rebuildRequestWithText(request, body, rewritten.text),
    env,
    ctx
  );
}

function stripFinancePrefix(value) {
  return String(value || '')
    .trim()
    .replace(/^financeiro\s+/i, '')
    .trim();
}

function rebuildRequestWithText(request, body, text) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...body, text })
  });
}

function parseCommandShell(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;

  let datePrefix = '';
  const dateMatch = raw.match(
    /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/
  );

  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    let year = dateMatch[3]
      ? Number(dateMatch[3])
      : Number(localDate().slice(0, 4));

    if (year < 100) year += 2000;
    if (!safeDate(year, month, day)) return null;

    datePrefix = dateMatch[0].trim();
    raw = raw.slice(dateMatch[0].length).trim();
  }

  const verbMatch = raw.match(
    /^(gasto|gastei|paguei|saida|saída|saiu|entrou|recebi|vendi|venda|compra|comprei|transfere|transferir|transferencia|transferência)\b\s*/i
  );

  if (!verbMatch) return null;

  return {
    verb: norm(verbMatch[1]),
    date_prefix: datePrefix,
    rest: raw.slice(verbMatch[0].length).trim()
  };
}

function rewriteCardPurchase(shell) {
  const amountMatch = shell.rest.match(
    /^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?)\s+/
  );

  if (!amountMatch) {
    return {
      ok: false,
      error:
        'Não consegui identificar o valor. Ex.: gasto 65 pneu da moto loja credito mercado pago empresa.'
    };
  }

  const amount = amountMatch[1];
  let rest = shell.rest.slice(amountMatch[0].length).trim();

  let category = null;
  const categoryMatch = rest.match(/\s+categoria\s+(.+)$/i);

  if (categoryMatch) {
    category = categoryMatch[1].trim();
    rest = rest.slice(0, categoryMatch.index).trim();
  }

  const n = norm(rest);
  let scope = null;

  if (/\b(?:uso )?pessoal\b/.test(n)) scope = 'pessoal';
  if (/\bempresa\b|\bempresarial\b/.test(n)) scope = 'empresa';

  if (
    !scope &&
    /\b(marmita|ifood|lanche|refeicao|comida|supermercado|casa)\b/.test(n)
  ) {
    scope = 'pessoal';
  }

  if (
    !scope &&
    /\b(loja|estoque|mercadoria|fornecedor|insumo|marketing|facebook|instagram|meta|pneu|moto|manutencao|reparo|conserto|gravo)\b/.test(n)
  ) {
    scope = 'empresa';
  }

  if (!scope) {
    return {
      ok: false,
      error:
        'Compra no Cartão Mercado Pago identificada. Informe PESSOAL ou EMPRESA.'
    };
  }

  if (!category) {
    if (/\bmarmita\b/.test(n)) {
      category = 'Marmita';
    } else if (
      /\b(supermercado|mercado)\b/.test(n) &&
      scope === 'pessoal'
    ) {
      category = 'Mercado pessoal';
    } else if (
      /\b(facebook|instagram|meta|marketing|anuncio|trafego)\b/.test(n)
    ) {
      category = 'Marketing e publicidade';
    } else if (
      /\b(pneu|moto|manutencao|reparo|conserto)\b/.test(n) &&
      scope === 'empresa'
    ) {
      category = 'Manutenção e reparos';
    } else if (/\bgravo\b/.test(n) && scope === 'empresa') {
      category = 'Sistemas e aplicativos';
    }
  }

  // Remove marcadores de forma de pagamento/escopo da descrição.
  rest = rest
    .replace(/\bmercado\s*pago\b/ig, ' ')
    .replace(/\b(?:credito|crédito)\b/ig, ' ')
    .replace(/\b(?:cartao|cartão)(?:\s+de\s+(?:credito|crédito))?\b/ig, ' ')
    .replace(/\b(?:uso\s+)?pessoal\b/ig, ' ')
    .replace(/\b(?:empresa|empresarial)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const date = shell.date_prefix ? `${shell.date_prefix} ` : '';

  let text =
    `${date}gasto ${amount} ${rest} credito mercado pago ${scope}`
      .replace(/\s+/g, ' ')
      .trim();

  if (category) {
    text += ` categoria ${category}`;
  }

  return { ok: true, text };
}

function safeDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;

  return (
    `${year}-` +
    `${String(month).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}`
  );
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

function freshHeaders(source) {
  const headers = new Headers(source);
  headers.delete('content-length');
  headers.set('cache-control', 'no-cache, no-store, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  return headers;
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
