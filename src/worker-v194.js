import worker192 from './worker-v192.js';

const VERSION = '1.9.4';
const SYSTEMS_CATEGORY = 'Sistemas e aplicativos';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      let forwardedRequest = request;

      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        forwardedRequest = await normalizeFinanceRequest(request);
      }

      const res = await worker192.fetch(forwardedRequest, env, ctx);

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

      /*
       * Fallback idêntico ao padrão que já estava estável na v1.9.3:
       * volta diretamente para a v1.9.2, sem encadear wrapper adicional.
       */
      return worker192.fetch(request, env, ctx);
    }
  }
};

async function normalizeFinanceRequest(request) {
  const body = await request.clone().json().catch(() => null);

  if (!body || typeof body.text !== 'string') {
    return request;
  }

  const normalizedText = normalizeFinanceCommandText(body.text);

  if (normalizedText === body.text) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({
      ...body,
      text: normalizedText
    })
  });
}

function normalizeFinanceCommandText(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return raw;
  }

  /*
   * Preserva o prefixo de data já reconhecido pelo parser-base.
   * Nesta v1.9.4 não alteramos a regra histórica do banco:
   * foco é estabilidade após o rollback.
   */
  const dateMatch = raw.match(
    /^\s*\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\s+/
  );

  const prefix = dateMatch ? dateMatch[0] : '';
  const rest = dateMatch ? raw.slice(prefix.length) : raw;

  const verbMatch = rest.match(
    /^(gasto|gastei|paguei|saida|saiu|entrou|recebi|vendi|venda|compra|comprei|transfere|transferir|transferencia|transferência)\b\s*/i
  );

  if (!verbMatch) {
    return raw;
  }

  const afterVerb = rest.slice(verbMatch[0].length);

  const moneyMatch = afterVerb.match(
    /^(?:R\$\s*)?(\d+(?:[.,]\d+)*)\b/i
  );

  let rebuilt = rest;

  /*
   * Mantém a correção de valores que já estava validada na v1.9.3:
   * 3500       -> 3500,00
   * 3.500      -> 3500,00
   * 3500,50    -> 3500,50
   * 3.500,50   -> 3500,50
   */
  if (moneyMatch) {
    const cents = parsePtMoneyToCentsV194(moneyMatch[1]);

    if (cents > 0) {
      const canonical = formatCanonicalMoney(cents);

      rebuilt =
        verbMatch[0] +
        afterVerb.replace(moneyMatch[0], canonical);
    }
  }

  let normalized = normalizeText(rebuilt);

  const expenseOrPurchase =
    /^(gasto|gastei|paguei|saida|saiu|compra|comprei)\b/.test(normalized);

  /*
   * GRAVO
   * Mantém o comportamento já usado na v1.9.3.
   */
  if (
    expenseOrPurchase &&
    /\bgravo\b/.test(normalized) &&
    !/\bcategoria\b/.test(normalized)
  ) {
    rebuilt =
      `${rebuilt.trim()} categoria ${SYSTEMS_CATEGORY}`;

    normalized = normalizeText(rebuilt);
  }

  /*
   * ACORDO
   * Facilita o comando curto que foi validado pelo usuário.
   *
   * Ex.:
   * paguei 38 acordo pix nubank
   *
   * vira:
   * paguei 38 acordo societario pix nubank
   *
   * Não mexe se o usuário já escreveu um acordo específico.
   */
  if (
    /^(gasto|gastei|paguei|saida|saiu)\b/.test(normalized) &&
    /\bacordo\b/.test(normalized) &&
    !/\bacordo societario\b/.test(normalized) &&
    !/\baquisicao societaria\b/.test(normalized) &&
    !/\bacordo empresa\b/.test(normalized)
  ) {
    rebuilt = rebuilt.replace(
      /\bacordo\b/i,
      'acordo societario'
    );
  }

  return `${prefix}${rebuilt}`.trim();
}

function parsePtMoneyToCentsV194(value) {
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
      (parts[1]
        ? `.${parts[1]}`
        : '');
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
        parts
          .slice(1)
          .every(part => part.length === 3)
      ) {
        normalized = parts.join('');
      } else {
        return 0;
      }
    }
  }

  const n = Number(normalized);

  return Number.isFinite(n) && n > 0
    ? Math.round(n * 100)
    : 0;
}

function formatCanonicalMoney(cents) {
  const n = Math.trunc(Number(cents));
  const whole = Math.floor(n / 100);
  const decimals =
    String(n % 100).padStart(2, '0');

  return `${whole},${decimals}`;
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
