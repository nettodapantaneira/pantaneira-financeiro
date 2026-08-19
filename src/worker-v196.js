import worker194 from './worker-v194.js';

const VERSION = '1.9.6';
const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname === '/api/internal/finance-command' &&
        request.method === 'POST'
      ) {
        const handled = await handleFinanceCommand(request, env, ctx);
        if (handled) return handled;
      }

      const response = await worker194.fetch(request, env, ctx);
      const type = response.headers.get('content-type') || '';

      if (url.pathname === '/api/health' && response.ok) {
        const data = await response.clone().json().catch(() => ({}));

        return json(
          {
            ...data,
            version: VERSION
          },
          response.status
        );
      }

      if (
        url.pathname === '/v194.js' &&
        response.ok &&
        type.includes('javascript')
      ) {
        let js = await response.text();

        js = js.replace(
          /const\s+VERSION\s*=\s*['"]1\.9\.4['"]\s*;/,
          `const VERSION = '${VERSION}';`
        );

        const headers = freshHeaders(response.headers);

        return new Response(js, {
          status: response.status,
          headers
        });
      }

      if (
        response.ok &&
        type.includes('text/html')
      ) {
        const headers = freshHeaders(response.headers);

        return new Response(
          await response.text(),
          {
            status: response.status,
            headers
          }
        );
      }

      return response;

    } catch (error) {
      console.error(
        'Pantaneira Financeiro v1.9.6',
        error
      );

      if (
        url.pathname.startsWith('/api/')
      ) {
        return json(
          {
            error:
              String(
                error?.message ||
                error
              )
          },
          400
        );
      }

      return worker194.fetch(
        request,
        env,
        ctx
      );
    }
  }
};

async function handleFinanceCommand(
  request,
  env,
  ctx
) {
  const body =
    await request
      .clone()
      .json()
      .catch(() => null);

  if (
    !body ||
    typeof body.text !== 'string'
  ) {
    return null;
  }

  const raw =
    String(
      body.text || ''
    ).trim();

  if (!raw) {
    return null;
  }

  /*
   * CORREÇÃO DE LANÇAMENTO ANTIGO
   *
   * WhatsApp:
   * corrigir cartao 120
   */
  const correction =
    raw.match(
      /^(?:corrigir|corrige|corrija)\s+(?:cartao|cartão)\s+#?(\d+)\s*$/i
    );

  if (correction) {
    return correctLegacyCardTransaction(
      request,
      env,
      ctx,
      Number(
        correction[1]
      )
    );
  }

  const normalized =
    normalizeText(raw);

  const mentionsMercadoPago =
    /\bmercado pago\b/
      .test(normalized);

  const mentionsCredit =
    /\b(credito|cartao|cartao de credito)\b/
      .test(normalized);

  /*
   * Se não é cartão Mercado Pago,
   * deixa o fluxo normal continuar.
   */
  if (
    !mentionsMercadoPago ||
    !mentionsCredit
  ) {
    return null;
  }

  /*
   * Aqui interceptamos ANTES do parser antigo.
   *
   * Assim:
   *
   * saiu 31 marmita mercado pago credito
   *
   * passa a ser compra no cartão,
   * em vez de saída bancária.
   */
  const rewritten =
    rewriteCardPurchaseCommand(
      raw
    );

  if (!rewritten.ok) {
    return json(
      {
        error:
          rewritten.error
      },
      400
    );
  }

  const headers =
    new Headers(
      request.headers
    );

  headers.set(
    'content-type',
    'application/json; charset=utf-8'
  );

  headers.delete(
    'content-length'
  );

  const forwarded =
    new Request(
      request.url,
      {
        method: 'POST',

        headers,

        body:
          JSON.stringify({
            ...body,
            text:
              rewritten.text
          })
      }
    );

  /*
   * Envia já normalizado para
   * a cadeia estável atual.
   *
   * O módulo de cartão existente
   * cria credit_card_items
   * e NÃO baixa o saldo bancário.
   */
  return worker194.fetch(
    forwarded,
    env,
    ctx
  );
}

function rewriteCardPurchaseCommand(
  raw
) {
  /*
   * Preserva data retroativa:
   *
   * 18/08 saiu 31 ...
   */
  const dateMatch =
    raw.match(
      /^(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\s+/
    );

  const datePrefix =
    dateMatch
      ? `${dateMatch[1]} `
      : '';

  let rest =
    dateMatch
      ? raw
          .slice(
            dateMatch[0].length
          )
          .trim()
      : raw.trim();

  /*
   * Agora aceita também:
   *
   * saiu
   * saída
   * paguei
   */
  const verbMatch =
    rest.match(
      /^(saiu|saida|saída|paguei|gasto|gastei|compra|comprei)\b\s*/i
    );

  if (!verbMatch) {
    return {
      ok: false,

      error:
        'Para compra no cartão use: gasto VALOR descrição credito mercado pago pessoal/empresa.'
    };
  }

  rest =
    rest
      .slice(
        verbMatch[0].length
      )
      .trim();

  /*
   * Valor.
   */
  const amountMatch =
    rest.match(
      /^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?)\s+/
    );

  if (!amountMatch) {
    return {
      ok: false,

      error:
        'Não consegui identificar o valor da compra no cartão.'
    };
  }

  const amount =
    amountMatch[1];

  let afterAmount =
    rest
      .slice(
        amountMatch[0].length
      )
      .trim();

  let normalized =
    normalizeText(
      afterAmount
    );

  /*
   * Segurança:
   * só intercepta se realmente
   * houver Mercado Pago.
   */
  if (
    !/\bmercado pago\b/
      .test(normalized)
  ) {
    return {
      ok: false,

      error:
        'Informe Mercado Pago no comando da compra no cartão.'
    };
  }

  if (
    !/\b(credito|cartao|cartao de credito)\b/
      .test(normalized)
  ) {
    return {
      ok: false,

      error:
        'Informe credito/cartao no comando da compra.'
    };
  }

  /*
   * PESSOAL x EMPRESA
   */
  let scope = null;

  if (
    /\b(pessoal|uso pessoal)\b/
      .test(normalized)
  ) {
    scope =
      'pessoal';
  }

  if (
    /\b(empresa|empresarial|loja)\b/
      .test(normalized)
  ) {
    scope =
      'empresa';
  }

  /*
   * Inferências seguras
   * para comandos comuns.
   */
  if (
    !scope &&
    /\b(marmita|ifood|lanche|refeicao|mercado|supermercado|casa)\b/
      .test(normalized)
  ) {
    scope =
      'pessoal';
  }

  if (
    !scope &&
    /\b(estoque|mercadoria|fornecedor|insumo|marketing|facebook|instagram|meta|pneu|moto da loja)\b/
      .test(normalized)
  ) {
    scope =
      'empresa';
  }

  /*
   * Se ainda for ambíguo,
   * NÃO deixa cair como saída bancária.
   */
  if (!scope) {
    return {
      ok: false,

      error:
        'Compra no cartão identificada. Informe se é pessoal ou empresa para não lançar na conta bancária por engano.'
    };
  }

  /*
   * Categoria escrita pelo usuário.
   */
  let category =
    extractCategory(
      afterAmount
    );

  /*
   * Categorias automáticas mais comuns.
   */
  if (!category) {

    if (
      /\bmarmita\b/
        .test(normalized)
    ) {
      category =
        'Marmita';
    }

    else if (
      /\b(mercado|supermercado)\b/
        .test(normalized) &&
      scope === 'pessoal'
    ) {
      category =
        'Mercado pessoal';
    }

    else if (
      /\b(facebook|instagram|meta|marketing|anuncio|trafego)\b/
        .test(normalized)
    ) {
      category =
        'Marketing e publicidade';
    }

    else if (
      /\b(pneu|moto|manutencao|reparo)\b/
        .test(normalized) &&
      scope === 'empresa'
    ) {
      category =
        'Manutenção e reparos';
    }
  }

  /*
   * Reconstrói o comando na forma
   * já aceita pelo módulo de cartão.
   *
   * Categoria precisa ficar no final.
   */
  afterAmount =
    removeCategoryClause(
      afterAmount
    );

  afterAmount =
    removeExplicitScope(
      afterAmount
    );

  afterAmount =
    `${afterAmount} ${scope}`
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  if (category) {
    afterAmount =
      `${afterAmount} categoria ${category}`;
  }

  return {
    ok: true,

    text:
      `${datePrefix}gasto ${amount} ${afterAmount}`
        .trim()
  };
}

function extractCategory(
  value
) {
  const match =
    String(
      value || ''
    )
      .match(
        /\bcategoria\s+(.+)$/i
      );

  return match
    ? match[1].trim()
    : null;
}

function removeCategoryClause(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /\s+categoria\s+(.+)$/i,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function removeExplicitScope(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /\b(?:uso\s+)?pessoal\b/ig,
      ' '
    )
    .replace(
      /\b(?:empresa|empresarial)\b/ig,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

/*
 * CORRIGE LANÇAMENTO ANTIGO
 *
 * Ex.:
 * corrigir cartao 120
 *
 * 1. lê #120
 * 2. cria compra na fatura
 * 3. cancela a saída bancária antiga
 * 4. preserva auditoria
 */
async function correctLegacyCardTransaction(
  request,
  env,
  ctx,
  transactionId
) {
  if (
    !Number.isInteger(
      transactionId
    ) ||
    transactionId <= 0
  ) {
    return json(
      {
        error:
          'ID inválido.'
      },
      400
    );
  }

  const secret =
    String(
      request.headers.get(
        'x-finance-bot-secret'
      ) ||
      ''
    );

  if (
    !secret ||
    !env.FINANCE_BOT_SECRET ||
    secret !==
      String(
        env.FINANCE_BOT_SECRET
      )
  ) {
    return json(
      {
        error:
          'Não autorizado.'
      },
      401
    );
  }

  const tx =
    await env.DB.prepare(`
      SELECT
        t.*,
        a.name source_account_name,
        c.name category_name

      FROM transactions t

      LEFT JOIN accounts a
        ON a.id=t.source_account_id

      LEFT JOIN categories c
        ON c.id=t.category_id

      WHERE t.id=?

      LIMIT 1
    `)
      .bind(
        transactionId
      )
      .first();

  if (!tx) {
    return json(
      {
        error:
          `Lançamento #${transactionId} não encontrado.`
      },
      404
    );
  }

  /*
   * Idempotência:
   * não duplica caso mande
   * corrigir novamente.
   */
  if (
    tx.status ===
    'void'
  ) {
    return json({
      ok: true,

      reply:
        `O lançamento #${transactionId} já está cancelado.`
    });
  }

  const sourceName =
    normalizeText(
      tx.source_account_name ||
      ''
    );

  /*
   * Só permite corrigir
   * exatamente o tipo de erro
   * que estamos tratando.
   */
  if (
    tx.direction !==
      'expense' ||

    tx.payment_method !==
      'credit' ||

    !sourceName.includes(
      'mercado pago'
    )
  ) {
    return json(
      {
        error:
          `O #${transactionId} não é uma saída no crédito vinculada à conta Mercado Pago.`
      },
      400
    );
  }

  const scope =
    inferScopeFromTransaction(
      tx
    );

  if (!scope) {
    return json(
      {
        error:
          `Não consegui definir se o #${transactionId} é pessoal ou empresa.`
      },
      400
    );
  }

  /*
   * Recupera a data original.
   */
  const purchaseDate =
    String(
      tx.occurred_at ||
      ''
    ).slice(
      0,
      10
    );

  const [
    year,
    month,
    day
  ] =
    purchaseDate.split(
      '-'
    );

  const amount =
    formatMoneyForCommand(
      Number(
        tx.amount_cents ||
        0
      )
    );

  /*
   * Cria comando sintético
   * para usar o módulo de cartão
   * já existente e validado.
   */
  let synthetic =
    `${day}/${month}/${year} ` +
    `gasto ${amount} ` +
    `${String(
      tx.description ||
      'Compra no cartão'
    ).trim()} ` +
    `credito mercado pago ${scope}`;

  if (
    tx.category_name
  ) {
    synthetic +=
      ` categoria ${tx.category_name}`;
  }

  const originalBody =
    await request
      .clone()
      .json()
      .catch(
        () => ({})
      );

  const headers =
    new Headers(
      request.headers
    );

  headers.set(
    'content-type',
    'application/json; charset=utf-8'
  );

  headers.delete(
    'content-length'
  );

  const cardRequest =
    new Request(
      request.url,
      {
        method:
          'POST',

        headers,

        body:
          JSON.stringify({
            ...originalBody,

            text:
              synthetic
          })
      }
    );

  /*
   * Usa o módulo de cartão existente.
   */
  const cardResponse =
    await worker194.fetch(
      cardRequest,
      env,
      ctx
    );

  const cardData =
    await cardResponse
      .clone()
      .json()
      .catch(
        () => ({})
      );

  if (
    !cardResponse.ok
  ) {
    return json(
      {
        error:
          cardData.error ||
          `Não foi possível criar a compra do cartão para o #${transactionId}.`
      },
      cardResponse.status
    );
  }

  /*
   * Só cancela a saída bancária
   * DEPOIS que a compra na fatura
   * foi criada com sucesso.
   */
  const before = {
    ...tx
  };

  const after = {
    ...tx,

    status:
      'void',

    notes:
      appendNote(
        tx.notes,

        `[V196_CARD_FIX] Convertido para compra na fatura. item_id=${cardData.item_id || ''}`
      )
  };

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE transactions

      SET
        status='void',
        notes=?,
        updated_at=CURRENT_TIMESTAMP

      WHERE id=?
    `)
      .bind(
        after.notes,
        transactionId
      ),

    env.DB.prepare(`
      INSERT INTO transaction_revisions(
        transaction_id,
        action,
        before_json,
        after_json
      )

      VALUES(
        ?,
        ?,
        ?,
        ?
      )
    `)
      .bind(
        transactionId,
        'void',
        JSON.stringify(
          before
        ),
        JSON.stringify(
          after
        )
      )
  ]);

  return json({
    ok: true,

    item_id:
      cardData.item_id ||
      null,

    bill_id:
      cardData.bill_id ||
      null,

    reply:
      `Corrigido #${transactionId}: ` +
      `${formatBRL(
        Number(
          tx.amount_cents ||
          0
        )
      )} saiu da conta bancária e foi movido para a fatura do Cartão Mercado Pago.\n` +
      `Saldo bancário deixou de ser reduzido por essa compra.`
  });
}

function inferScopeFromTransaction(
  tx
) {
  const nature =
    String(
      tx.nature ||
      ''
    );

  const text =
    normalizeText(
      `${tx.description || ''} ${tx.category_name || ''}`
    );

  if (
    nature ===
    'personal_withdrawal'
  ) {
    return 'pessoal';
  }

  if (
    nature ===
      'business_operating' ||

    nature ===
      'inventory' ||

    nature ===
      'business_debt'
  ) {
    return 'empresa';
  }

  if (
    /\b(marmita|ifood|lanche|mercado|supermercado|pessoal)\b/
      .test(text)
  ) {
    return 'pessoal';
  }

  if (
    /\b(loja|empresa|estoque|mercadoria|fornecedor|marketing|pneu|moto)\b/
      .test(text)
  ) {
    return 'empresa';
  }

  return null;
}

function formatMoneyForCommand(
  cents
) {
  const value =
    Number(
      cents ||
      0
    ) /
    100;

  return value
    .toFixed(2)
    .replace(
      '.',
      ','
    );
}

function formatBRL(
  cents
) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style:
        'currency',

      currency:
        'BRL'
    }
  )
    .format(
      Number(
        cents ||
        0
      ) /
      100
    );
}

function appendNote(
  current,
  addition
) {
  return [
    String(
      current ||
      ''
    ).trim(),

    String(
      addition ||
      ''
    ).trim()
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeText(
  value
) {
  return String(
    value ||
    ''
  )
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function freshHeaders(
  source
) {
  const headers =
    new Headers(
      source
    );

  headers.delete(
    'content-length'
  );

  headers.set(
    'cache-control',
    'no-cache, no-store, must-revalidate'
  );

  headers.set(
    'pragma',
    'no-cache'
  );

  headers.set(
    'expires',
    '0'
  );

  return headers;
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data
    ),
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
