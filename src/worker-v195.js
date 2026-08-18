import worker192 from './worker-v192.js';

const VERSION = '1.9.5';
const TZ = 'America/Cuiaba';
const HISTORICAL_END = '2026-08-10';
const SYSTEMS_CATEGORY = 'Sistemas e aplicativos';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const txMatch = url.pathname.match(/^\/api\/v195\/transactions\/(\d+)$/);
      if (txMatch && request.method === 'GET') {
        return handleTransactionDetail(request, env, ctx, Number(txMatch[1]));
      }

      const moveMatch = url.pathname.match(/^\/api\/v195\/transactions\/(\d+)\/move-to-card$/);
      if (moveMatch && request.method === 'POST') {
        return handleMoveToCard(request, env, ctx, Number(moveMatch[1]));
      }

      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        return handleFinanceCommand(request, env, ctx);
      }

      const res = await worker192.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, res.status);
      }

      const type = res.headers.get('content-type') || '';

      if (res.ok && type.includes('text/html')) {
        let html = await res.text();

        if (!html.includes('/v195.js')) {
          html = html.replace(
            '</body>',
            `<script src="/v195.js?v=${VERSION}"></script></body>`
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
      console.error('v1.9.5', error);

      if (url.pathname.startsWith('/api/')) {
        return json(
          {
            error: String(error?.message || error),
            version: VERSION
          },
          400
        );
      }

      return worker192.fetch(request, env, ctx);
    }
  }
};

async function handleFinanceCommand(request, env, ctx) {
  const body = await request.clone().json().catch(() => null);

  if (!body || typeof body.text !== 'string') {
    return worker192.fetch(request, env, ctx);
  }

  let text = normalizeCommand(body.text);

  if (!text) {
    return worker192.fetch(request, env, ctx);
  }

  if (isGrossMercadoPagoCardSale(text)) {
    return json({
      ok: false,
      error: 'Venda bruta de cartão não deve movimentar o saldo bancário do Mercado Pago.',
      reply:
        'Não registrei esta venda no saldo do Mercado Pago.\n\n' +
        'Crédito/débito é faturamento bruto. No banco registre somente a liberação líquida que apareceu no extrato.\n\n' +
        'Exemplo: entrou 180,38 liberacao mercado pago'
    }, 400);
  }

  if (isMercadoPagoCardExpense(text) && !hasScope(text)) {
    return json({
      ok: false,
      error: 'Informe se a compra do cartão Mercado Pago é pessoal ou da empresa.',
      reply:
        'Não registrei para evitar lançar compra de cartão como saída da conta bancária.\n\n' +
        'Informe PESSOAL ou EMPRESA.\n\n' +
        'Exemplos:\n' +
        'gasto 52,87 mercado credito mercado pago pessoal\n' +
        'gasto 49,90 gravo credito mercado pago empresa'
    }, 400);
  }

  const dateInfo = extractDatePrefix(text);
  const cardPurchase = isMercadoPagoCardExpense(text) && hasScope(text);

  if (
    dateInfo &&
    !cardPurchase &&
    isOrdinaryIncomeExpense(dateInfo.rest) &&
    dateInfo.iso > HISTORICAL_END
  ) {
    const today = localDate();

    if (dateInfo.iso > today) {
      return json({
        ok: false,
        error: 'A data informada está no futuro.',
        reply: 'Não registrei: a data informada está no futuro.'
      }, 400);
    }

    if (dateInfo.iso !== today) {
      const forwarded = makeJsonRequest(request, {
        ...body,
        text: dateInfo.rest
      });

      const res = await worker192.fetch(forwarded, env, ctx);

      if (!res.ok) {
        return res;
      }

      const data = await res.clone().json().catch(() => null);
      const id = transactionIdFromReply(data?.reply);

      if (!id) {
        return res;
      }

      const before = await env.DB.prepare(
        "SELECT * FROM transactions WHERE id=? AND status!='void' LIMIT 1"
      ).bind(id).first();

      if (!before) {
        return res;
      }

      const occurredAt = `${dateInfo.iso}T16:00:00.000Z`;
      const periodKey = dateInfo.iso.slice(0, 7);

      await env.DB.prepare(`
        UPDATE transactions
        SET occurred_at=?,
            period_key=?,
            notes=CASE
              WHEN COALESCE(notes,'')='' THEN 'Data retroativa WhatsApp v1.9.5'
              WHEN instr(notes,'Data retroativa WhatsApp v1.9.5')>0 THEN notes
              ELSE notes || ' · Data retroativa WhatsApp v1.9.5'
            END,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(occurredAt, periodKey, id).run();

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
        JSON.stringify(before),
        JSON.stringify(after)
      ).run().catch(() => {});

      if (data?.reply) {
        data.reply = replaceOrAppendDate(data.reply, dateInfo.iso);
        data.reply += '\nData retroativa aplicada pela v1.9.5.';
        return json(data, res.status);
      }

      return res;
    }
  }

  const forwarded = makeJsonRequest(request, {
    ...body,
    text
  });

  return worker192.fetch(forwarded, env, ctx);
}

async function handleTransactionDetail(request, env, ctx, id) {
  const auth = await requireSession(request, env, ctx);
  if (auth) return auth;

  const row = await env.DB.prepare(`
    SELECT
      t.*,
      sa.name AS source_account_name,
      da.name AS destination_account_name,
      c.name AS category_name,
      c.nature AS category_nature,
      p.name AS parent_category_name,
      d.name AS debt_name,
      o.name AS obligation_name
    FROM transactions t
    LEFT JOIN accounts sa ON sa.id=t.source_account_id
    LEFT JOIN accounts da ON da.id=t.destination_account_id
    LEFT JOIN categories c ON c.id=t.category_id
    LEFT JOIN categories p ON p.id=c.parent_id
    LEFT JOIN debts d ON d.id=t.debt_id
    LEFT JOIN obligations o ON o.id=t.obligation_id
    WHERE t.id=?
    LIMIT 1
  `).bind(id).first();

  if (!row) {
    return json({ error: 'Lançamento não encontrado.' }, 404);
  }

  return json({
    transaction: row,
    flags: {
      mercado_pago_credit_as_bank_expense: isWrongMercadoPagoBankExpense(row),
      has_debt_link: Boolean(row.debt_id),
      opening_history: Boolean(Number(row.opening_history || 0))
    }
  });
}

async function handleMoveToCard(request, env, ctx, id) {
  const auth = await requireSession(request, env, ctx);
  if (auth) return auth;

  const body = await request.clone().json().catch(() => ({}));
  const scope = body.scope === 'personal'
    ? 'personal'
    : body.scope === 'business'
      ? 'business'
      : null;

  if (!scope) {
    return json({ error: 'Escolha Empresa ou Pessoal.' }, 400);
  }

  const t = await env.DB.prepare(`
    SELECT
      t.*,
      a.name AS source_account_name,
      c.name AS category_name,
      c.nature AS category_nature
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.source_account_id
    LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.id=?
    LIMIT 1
  `).bind(id).first();

  if (!t || t.status === 'void') {
    return json({ error: 'Lançamento não encontrado ou já cancelado.' }, 404);
  }

  if (!isWrongMercadoPagoBankExpense(t)) {
    return json({
      error:
        'Este lançamento não atende aos critérios de conversão automática para o Cartão Mercado Pago.'
    }, 400);
  }

  if (!env.FINANCE_BOT_SECRET) {
    return json({
      error:
        'FINANCE_BOT_SECRET não está configurado. Não foi feita nenhuma alteração.'
    }, 500);
  }

  const purchaseDate = String(t.occurred_at || '').slice(0, 10);
  const datePrefix = isoToBR(purchaseDate);
  const amount = formatCanonicalMoney(Number(t.amount_cents || 0));
  const description = cleanCardDescription(t.description);
  const scopeWord = scope === 'personal' ? 'pessoal' : 'empresa';

  let categoryPart = '';

  if (
    t.category_name &&
    (
      (scope === 'personal' && t.category_nature === 'personal_withdrawal') ||
      (
        scope === 'business' &&
        ['business_operating', 'inventory'].includes(t.category_nature)
      )
    )
  ) {
    categoryPart = ` categoria ${t.category_name}`;
  }

  const command =
    `${datePrefix} gasto ${amount} ${description} ` +
    `credito mercado pago ${scopeWord}${categoryPart}`;

  const internalHeaders = new Headers();
  internalHeaders.set('content-type', 'application/json; charset=utf-8');
  internalHeaders.set(
    'x-finance-bot-secret',
    String(env.FINANCE_BOT_SECRET)
  );

  const internalRequest = new Request(
    new URL('/api/internal/finance-command', request.url),
    {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({
        from: env.WHATSAPP_ALLOWED_NUMBER,
        text: command
      })
    }
  );

  const createdRes = await worker192.fetch(internalRequest, env, ctx);
  const createdData = await createdRes.clone().json().catch(() => ({}));

  if (!createdRes.ok || !createdData?.item_id) {
    return json({
      error:
        createdData?.error ||
        'Não foi possível criar a compra na fatura. O lançamento bancário foi preservado.'
    }, createdRes.status || 400);
  }

  const sessionHeaders = new Headers(request.headers);
  sessionHeaders.delete('content-length');

  const deleteOriginal = await worker192.fetch(
    new Request(
      new URL(`/api/transactions/${id}`, request.url),
      {
        method: 'DELETE',
        headers: sessionHeaders
      }
    ),
    env,
    ctx
  );

  if (!deleteOriginal.ok) {
    const rollback = await worker192.fetch(
      new Request(
        new URL(`/api/card-items/${createdData.item_id}`, request.url),
        {
          method: 'DELETE',
          headers: sessionHeaders
        }
      ),
      env,
      ctx
    );

    if (rollback.ok) {
      return json({
        error:
          'Não foi possível cancelar a saída bancária. A compra criada na fatura foi revertida; nenhum dado ficou duplicado.'
      }, 409);
    }

    return json({
      error:
        'Falha crítica na conversão. A compra foi criada, mas não consegui cancelar o lançamento original nem reverter a compra. Não faça novos ajustes e revise o ID informado.',
      item_id: createdData.item_id,
      bill_id: createdData.bill_id
    }, 500);
  }

  return json({
    ok: true,
    transaction_id: id,
    item_id: createdData.item_id,
    bill_id: createdData.bill_id,
    scope,
    message:
      'Lançamento movido para a fatura. A saída bancária foi cancelada e a auditoria foi preservada.'
  });
}

async function requireSession(request, env, ctx) {
  const probe = await worker192.fetch(
    new Request(
      new URL('/api/accounts', request.url),
      {
        method: 'GET',
        headers: request.headers
      }
    ),
    env,
    ctx
  );

  if (probe.status === 401) {
    return json({ error: 'Sessão expirada.' }, 401);
  }

  if (!probe.ok) {
    return json({
      error: 'Não foi possível validar a sessão.'
    }, probe.status);
  }

  return null;
}

function isWrongMercadoPagoBankExpense(t) {
  const account = normalizeText(t.source_account_name || '');
  const description = normalizeText(t.description || '');
  const method = normalizeText(t.payment_method || '');

  return (
    t.direction === 'expense' &&
    t.status !== 'void' &&
    method === 'credit' &&
    (
      account.includes('mercado pago') ||
      description.includes('mercado pago')
    )
  );
}

function normalizeCommand(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const date = extractDatePrefix(raw);
  const prefix = date
    ? raw.slice(0, raw.length - date.rest.length)
    : '';

  let rest = date ? date.rest : raw;

  rest = normalizeMoneyAfterVerb(rest);
  rest = normalizeAgreementAlias(rest);
  rest = normalizeGravo(rest);

  return `${prefix}${rest}`.trim();
}

function normalizeMoneyAfterVerb(rest) {
  const verbMatch = String(rest).match(
    /^(gasto|gastei|paguei|saida|saiu|entrou|recebi|vendi|venda|compra|comprei|transfere|transferir|transferencia|transferência)\b\s*/i
  );

  if (!verbMatch) return rest;

  const afterVerb = rest.slice(verbMatch[0].length);
  const moneyMatch = afterVerb.match(
    /^(?:R\$\s*)?(\d+(?:[.,]\d+)*)\b/i
  );

  if (!moneyMatch) return rest;

  const cents = parsePtMoneyToCents(moneyMatch[1]);
  if (cents <= 0) return rest;

  const canonical = formatCanonicalMoney(cents);

  return (
    verbMatch[0] +
    afterVerb.replace(moneyMatch[0], canonical)
  );
}

function normalizeAgreementAlias(text) {
  const n = normalizeText(text);

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
    return String(text).replace(
      /\bacordo\b/i,
      'acordo societario'
    );
  }

  return text;
}

function normalizeGravo(text) {
  const n = normalizeText(text);

  if (!/^(gasto|gastei|paguei|saida|saiu|compra|comprei)\b/.test(n)) {
    return text;
  }

  if (!/\bgravo\b/.test(n)) {
    return text;
  }

  if (/\bcategoria\b/.test(n)) {
    return text;
  }

  return `${String(text).trim()} categoria ${SYSTEMS_CATEGORY}`;
}

function isGrossMercadoPagoCardSale(text) {
  const n = normalizeText(stripDatePrefix(text));

  if (!/^(entrou|recebi|vendi|venda|vendas)\b/.test(n)) {
    return false;
  }

  if (!/\bmercado pago\b/.test(n)) {
    return false;
  }

  if (/\bliberacao\b|\bliberado\b|\bliquido\b/.test(n)) {
    return false;
  }

  return /\bcredito\b|\bdebito\b/.test(n);
}

function isMercadoPagoCardExpense(text) {
  const n = normalizeText(stripDatePrefix(text));

  if (!/^(gasto|gastei|compra|comprei)\b/.test(n)) {
    return false;
  }

  if (!/\bmercado pago\b/.test(n)) {
    return false;
  }

  return /\bcredito\b|\bcartao\b/.test(n);
}

function hasScope(text) {
  const n = normalizeText(stripDatePrefix(text));

  return (
    /\bpessoal\b/.test(n) ||
    /\bempresa\b|\bempresarial\b/.test(n)
  );
}

function isOrdinaryIncomeExpense(text) {
  const n = normalizeText(text);

  return /^(entrou|recebi|vendi|venda|gasto|gastei|paguei|saida|saiu)\b/.test(n);
}

function extractDatePrefix(text) {
  const raw = String(text || '').trim();

  const m = raw.match(
    /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/
  );

  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3]
    ? Number(m[3])
    : Number(localDate().slice(0, 4));

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
  return extractDatePrefix(text)?.rest ||
    String(text || '').trim();
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

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
  const br = isoToBR(iso);
  const s = String(reply || '');

  if (/^Data:\s*.+$/mi.test(s)) {
    return s.replace(
      /^Data:\s*.+$/mi,
      `Data: ${br}`
    );
  }

  const idMatch = s.match(/\nID\s*#\d+/i);

  if (idMatch) {
    return s.replace(
      idMatch[0],
      `\nData: ${br}${idMatch[0]}`
    );
  }

  return `${s}\nData: ${br}`;
}

function makeJsonRequest(request, body) {
  const headers = new Headers(request.headers);

  headers.set(
    'content-type',
    'application/json; charset=utf-8'
  );

  headers.delete('content-length');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

function parsePtMoneyToCents(value) {
  let s = String(value || '')
    .trim()
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');

  if (!/^\d+(?:[.,]\d+)*$/.test(s)) {
    return 0;
  }

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized = s;

  if (hasComma && hasDot) {
    const decimalSep =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? ','
        : '.';

    const thousandSep =
      decimalSep === ','
        ? '.'
        : ',';

    const parts = s.split(decimalSep);

    if (
      parts.length !== 2 ||
      parts[1].length > 2
    ) {
      return 0;
    }

    normalized =
      parts[0].split(thousandSep).join('') +
      (parts[1] ? `.${parts[1]}` : '');
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const parts = s.split(sep);

    if (parts.length === 2) {
      const [left, right] = parts;

      if (
        right.length === 3 &&
        left.length <= 3
      ) {
        normalized = left + right;
      } else if (right.length <= 2) {
        normalized = `${left}.${right}`;
      } else {
        return 0;
      }
    } else {
      if (
        parts.slice(1).every(
          part => part.length === 3
        )
      ) {
        normalized = parts.join('');
      } else {
        return 0;
      }
    }
  }

  const n = Number(normalized);

  return (
    Number.isFinite(n) &&
    n > 0
  )
    ? Math.round(n * 100)
    : 0;
}

function formatCanonicalMoney(cents) {
  const n = Math.trunc(Number(cents || 0));
  const whole = Math.floor(n / 100);
  const decimals = String(n % 100).padStart(2, '0');

  return `${whole},${decimals}`;
}

function cleanCardDescription(value) {
  let s = String(value || '');

  s = s
    .replace(/\bmercado\s*pago\b/ig, ' ')
    .replace(/\bcart[aã]o(?:\s+de)?\s+cr[eé]dito\b/ig, ' ')
    .replace(/\bcr[eé]dito\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s || 'Compra no cartão';
}

function isoToBR(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');

  return (
    y && m && d
      ? `${d}/${m}/${y}`
      : String(iso || '')
  );
}

function localDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(new Date());
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store'
      }
    }
  );
}
