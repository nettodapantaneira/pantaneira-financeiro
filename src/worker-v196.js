import worker195 from './worker-v195.js';

const VERSION = '1.9.6';
const TAG = 'IMPORT_V196';
const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname === '/api/v196/import-meta' &&
        request.method === 'GET'
      ) {
        const denied = await requireSession(request, env, ctx);
        if (denied) return denied;

        return json(await meta(env.DB));
      }

      if (
        url.pathname === '/api/v196/import-preview' &&
        request.method === 'POST'
      ) {
        const denied = await requireSession(request, env, ctx);
        if (denied) return denied;

        return json(
          await preview(
            env.DB,
            await readJson(request)
          )
        );
      }

      if (
        url.pathname === '/api/v196/import-commit' &&
        request.method === 'POST'
      ) {
        const denied = await requireSession(request, env, ctx);
        if (denied) return denied;

        return json(
          await commit(
            env.DB,
            await readJson(request)
          ),
          201
        );
      }

      const response =
        await worker195.fetch(
          request,
          env,
          ctx
        );

      const type =
        response.headers.get('content-type') || '';

      if (
        url.pathname === '/api/health' &&
        response.ok
      ) {
        const data =
          await response
            .clone()
            .json()
            .catch(() => ({}));

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
        let js =
          await response.text();

        js =
          js.replace(
            /const\s+VERSION\s*=\s*['"]1\.9\.4['"]/g,
            `const VERSION = '${VERSION}'`
          );

        const headers =
          new Headers(response.headers);

        headers.delete('content-length');
        headers.set(
          'cache-control',
          'no-cache'
        );

        return new Response(
          js,
          {
            status: response.status,
            headers
          }
        );
      }

      if (
        response.ok &&
        type.includes('text/html')
      ) {
        let html =
          await response.text();

        if (
          !html.includes(
            'data-pf-v196'
          )
        ) {
          html =
            html.replace(
              '</body>',
              `${ui()}</body>`
            );
        }

        const headers =
          new Headers(response.headers);

        headers.delete('content-length');
        headers.set(
          'cache-control',
          'no-cache'
        );

        return new Response(
          html,
          {
            status: response.status,
            headers
          }
        );
      }

      return response;

    } catch (error) {
      console.error(
        'v1.9.6',
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

      return worker195.fetch(
        request,
        env,
        ctx
      );
    }
  }
};

async function requireSession(
  request,
  env,
  ctx
) {
  const probe =
    new Request(
      new URL(
        '/api/accounts',
        request.url
      ),
      {
        method: 'GET',
        headers: request.headers
      }
    );

  const response =
    await worker195.fetch(
      probe,
      env,
      ctx
    );

  if (
    response.status === 401
  ) {
    return json(
      {
        error:
          'Sessão expirada.'
      },
      401
    );
  }

  if (!response.ok) {
    return json(
      {
        error:
          'Não foi possível validar a sessão.'
      },
      response.status
    );
  }

  return null;
}

async function meta(db) {
  return {
    version: VERSION,
    accounts:
      await accounts(db)
  };
}

async function preview(
  db,
  body
) {
  const accountId =
    pos(
      body.account_id,
      'Conta'
    );

  const text =
    String(
      body.text || ''
    ).trim();

  if (!text) {
    throw new Error(
      'Cole o extrato antes de analisar.'
    );
  }

  const accts =
    await accounts(db);

  const cats =
    await categories(db);

  const debts =
    await debtRows(db);

  const selected =
    accts.find(
      a =>
        Number(a.id) ===
        accountId
    );

  if (!selected) {
    throw new Error(
      'Conta selecionada não encontrada.'
    );
  }

  const parsed =
    parseStatement(
      text,
      Number(
        body.default_year
      ) ||
      Number(
        localDate().slice(
          0,
          4
        )
      )
    );

  if (!parsed.length) {
    throw new Error(
      'Não encontrei movimentos no texto colado.'
    );
  }

  const rows = [];

  for (
    const item of parsed
  ) {
    const row =
      classify(
        item,
        selected,
        accts,
        cats,
        debts
      );

    row.fingerprint =
      hash(
        [
          row.date,
          row.time,
          row.direction,
          row.amount_cents,
          row.source_account_id,
          row.destination_account_id,
          norm(
            row.description
          )
        ].join('|')
      );

    const dup =
      await duplicate(
        db,
        row
      );

    row.duplicate =
      dup
        ? {
            id:
              Number(dup.id),
            description:
              dup.description
          }
        : null;

    if (dup) {
      row.selected =
        false;

      row.status =
        `Duplicado #${dup.id}`;

      row.status_type =
        'duplicate';

    } else if (
      !row.selected
    ) {
      row.status_type =
        'review';

    } else {
      row.status_type =
        'ready';
    }

    rows.push(row);
  }

  return {
    account: {
      id:
        Number(selected.id),

      name:
        selected.name,

      balance_cents:
        Number(
          selected.balance_cents ||
          0
        )
    },

    rows,

    summary: {
      total:
        rows.length,

      ready:
        rows.filter(
          r =>
            r.selected &&
            !r.duplicate
        ).length,

      duplicate:
        rows.filter(
          r =>
            r.duplicate
        ).length,

      review:
        rows.filter(
          r =>
            !r.selected &&
            !r.duplicate
        ).length
    }
  };
}

async function commit(
  db,
  body
) {
  const accountId =
    pos(
      body.account_id,
      'Conta'
    );

  const source =
    await db.prepare(
      `
      SELECT
        id,
        name,
        active
      FROM accounts
      WHERE id=?
      `
    )
      .bind(accountId)
      .first();

  if (
    !source ||
    !Number(source.active)
  ) {
    throw new Error(
      'Conta inválida.'
    );
  }

  const rows =
    Array.isArray(
      body.rows
    )
      ? body.rows.filter(
          r =>
            r.selected !== false &&
            !r.duplicate
        )
      : [];

  if (!rows.length) {
    throw new Error(
      'Nenhum movimento selecionado.'
    );
  }

  if (
    rows.length > 150
  ) {
    throw new Error(
      'Importe no máximo 150 movimentos por vez.'
    );
  }

  let imported = 0;
  let duplicates = 0;

  for (
    const raw of rows
  ) {
    const row =
      normalizeRow(
        raw,
        accountId
      );

    if (
      await duplicate(
        db,
        row
      )
    ) {
      duplicates++;
      continue;
    }

    const notes =
      `[${TAG}:${row.fingerprint}] ` +
      `Importado em lote pela Conciliação v1.9.6.` +
      (
        row.import_note
          ? ` ${row.import_note}`
          : ''
      );

    const occurredAt =
      `${row.date}T` +
      `${row.time || '12:00'}` +
      `:00-04:00`;

    const result =
      await db.prepare(
        `
        INSERT INTO transactions(
          occurred_at,
          period_key,
          direction,
          amount_cents,
          source_account_id,
          destination_account_id,
          nature,
          category_id,
          obligation_id,
          debt_id,
          description,
          notes,
          payment_method,
          recurrence_type,
          status,
          opening_history
        )
        VALUES(
          ?,?,?,?,?,?,?,?,
          NULL,
          ?,?,?,?,
          'eventual',
          'posted',
          0
        )
        `
      )
        .bind(
          occurredAt,
          row.date.slice(0, 7),
          row.direction,
          row.amount_cents,
          row.source_account_id,
          row.destination_account_id,
          row.nature,
          row.category_id,
          row.debt_id,
          row.description,
          notes,
          row.payment_method
        )
        .run();

    const id =
      Number(
        result.meta.last_row_id
      );

    if (
      row.debt_id &&
      row.direction ===
        'expense'
    ) {
      const debt =
        await db.prepare(
          `
          SELECT
            current_balance_cents
          FROM debts
          WHERE id=?
          `
        )
          .bind(
            row.debt_id
          )
          .first();

      if (
        debt?.current_balance_cents != null
      ) {
        const next =
          Math.max(
            0,
            Number(
              debt.current_balance_cents
            ) -
            row.amount_cents
          );

        await db.prepare(
          `
          UPDATE debts
          SET
            current_balance_cents=?,
            status=
              CASE
                WHEN ?=0
                THEN 'paid'
                ELSE status
              END,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=?
          `
        )
          .bind(
            next,
            next,
            row.debt_id
          )
          .run();
      }
    }

    const after =
      await db.prepare(
        `
        SELECT *
        FROM transactions
        WHERE id=?
        `
      )
        .bind(id)
        .first();

    await db.prepare(
      `
      INSERT INTO transaction_revisions(
        transaction_id,
        action,
        before_json,
        after_json
      )
      VALUES(
        ?,
        'create',
        NULL,
        ?
      )
      `
    )
      .bind(
        id,
        JSON.stringify(after)
      )
      .run()
      .catch(
        () => null
      );

    imported++;
  }

  const balance =
    await balanceOf(
      db,
      accountId
    );

  return {
    ok: true,

    imported,

    duplicates,

    account: {
      id:
        accountId,

      name:
        source.name,

      balance_cents:
        Number(
          balance?.balance_cents ||
          0
        )
    }
  };
}

function normalizeRow(
  raw,
  selectedAccountId
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        String(
          raw.date || ''
        )
      )
  ) {
    throw new Error(
      'Data inválida.'
    );
  }

  const direction =
    [
      'income',
      'expense',
      'transfer'
    ].includes(
      raw.direction
    )
      ? raw.direction
      : null;

  if (!direction) {
    throw new Error(
      'Tipo de movimento inválido.'
    );
  }

  const amount =
    pos(
      raw.amount_cents,
      'Valor'
    );

  let source =
    nullable(
      raw.source_account_id
    );

  let destination =
    nullable(
      raw.destination_account_id
    );

  let category =
    nullable(
      raw.category_id
    );

  let debt =
    nullable(
      raw.debt_id
    );

  let nature =
    String(
      raw.nature || ''
    );

  if (
    direction === 'income'
  ) {
    source =
      null;

    destination =
      destination ||
      selectedAccountId;

    nature =
      'income';

    debt =
      null;

    if (!category) {
      throw new Error(
        `Categoria ausente: ${raw.description}`
      );
    }
  }

  if (
    direction === 'expense'
  ) {
    source =
      source ||
      selectedAccountId;

    destination =
      null;

    if (!category) {
      throw new Error(
        `Categoria ausente: ${raw.description}`
      );
    }
  }

  if (
    direction === 'transfer'
  ) {
    nature =
      'transfer';

    category =
      null;

    debt =
      null;

    if (
      !source &&
      !destination
    ) {
      throw new Error(
        `Transferência sem conta: ${raw.description}`
      );
    }
  }

  return {
    date:
      String(raw.date),

    time:
      /^\d{2}:\d{2}$/
        .test(
          String(
            raw.time || ''
          )
        )
        ? raw.time
        : '12:00',

    direction,

    amount_cents:
      amount,

    source_account_id:
      source,

    destination_account_id:
      destination,

    nature,

    category_id:
      category,

    debt_id:
      debt,

    description:
      String(
        raw.description ||
        'Movimento importado'
      ).trim(),

    payment_method:
      String(
        raw.payment_method ||
        (
          direction ===
            'transfer'
            ? 'transfer'
            : 'pix'
        )
      ),

    import_note:
      String(
        raw.import_note ||
        ''
      ),

    fingerprint:
      String(
        raw.fingerprint ||
        hash(
          JSON.stringify(raw)
        )
      )
  };
}

function classify(
  item,
  selected,
  accts,
  cats,
  debts
) {
  const t =
    norm(
      `${item.description} ` +
      `${item.detail || ''}`
    );

  const row = {
    ...item,

    selected:
      true,

    status:
      'Pronto',

    direction:
      item.sign > 0
        ? 'income'
        : 'expense',

    nature:
      item.sign > 0
        ? 'income'
        : 'business_operating',

    category_id:
      null,

    debt_id:
      null,

    source_account_id:
      item.sign < 0
        ? Number(selected.id)
        : null,

    destination_account_id:
      item.sign > 0
        ? Number(selected.id)
        : null,

    payment_method:
      /boleto/.test(t)
        ? 'boleto'
        : /debito/.test(t)
          ? 'debit'
          : 'pix',

    import_note:
      ''
  };

  const cat =
    (...names) =>
      findCategory(
        cats,
        names
      );

  const debt =
    (...names) =>
      findDebt(
        debts,
        names
      );

  const other =
    name =>
      accts.find(
        a =>
          Number(a.id) !==
            Number(selected.id) &&
          norm(a.name)
            .includes(
              norm(name)
            )
      );

  if (
    /rendimento|cdi/
      .test(t)
  ) {
    row.category_id =
      cat(
        'Rendimentos financeiros',
        'Outras receitas'
      )?.id ||
      null;

    row.description =
      'Rendimentos';

    row.import_note =
      'Rendimento bancário/CDI.';

  } else if (
    /liberacao de dinheiro/
      .test(t)
  ) {
    row.direction =
      'transfer';

    row.nature =
      'transfer';

    row.category_id =
      null;

    row.source_account_id =
      null;

    row.destination_account_id =
      Number(selected.id);

    row.payment_method =
      'transfer';

    row.description =
      'Liberação de dinheiro';

    row.import_note =
      'Recebível liberado; não é nova venda.';

  } else if (
    /linha de credito|emprestimo pessoal|deposito do emprestimo/
      .test(t)
  ) {
    row.direction =
      'transfer';

    row.nature =
      'transfer';

    row.category_id =
      null;

    row.source_account_id =
      null;

    row.destination_account_id =
      Number(selected.id);

    row.payment_method =
      'transfer';

    row.description =
      'Entrada de linha de crédito';

    row.import_note =
      'Capital/financiamento; não é faturamento.';

  } else if (
    /gerson lafayette|gerson bastos/
      .test(t)
  ) {
    const mp =
      other(
        'Mercado Pago'
      );

    const nu =
      other(
        'Nubank'
      );

    const counterpart =
      norm(selected.name)
        .includes(
          'mercado pago'
        )
        ? nu
        : norm(selected.name)
            .includes(
              'nubank'
            )
          ? mp
          : null;

    if (counterpart) {
      row.direction =
        'transfer';

      row.nature =
        'transfer';

      row.category_id =
        null;

      row.debt_id =
        null;

      row.payment_method =
        'transfer';

      if (
        item.sign < 0
      ) {
        row.source_account_id =
          Number(
            selected.id
          );

        row.destination_account_id =
          Number(
            counterpart.id
          );

      } else {
        row.source_account_id =
          Number(
            counterpart.id
          );

        row.destination_account_id =
          Number(
            selected.id
          );
      }

      row.description =
        `${selected.name} ↔ ${counterpart.name}`;

      row.import_note =
        'Transferência entre contas próprias.';

    } else {
      row.selected =
        false;

      row.status =
        'Revisar transferência';
    }

  } else if (
    /cartao de credito/
      .test(t) &&
    /pagamento/
      .test(t)
  ) {
    row.selected =
      false;

    row.status =
      'Usar Cartões e faturas';

    row.import_note =
      'Pagamento de fatura deve ser vinculado no módulo de cartões.';

  } else if (
    /davi alef/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'business_debt';

    row.category_id =
      cat(
        'Aquisição de participação societária',
        'Empréstimos e acordos'
      )?.id ||
      null;

    row.debt_id =
      debt(
        'Acordo societário',
        'Elaine'
      )?.id ||
      null;

    row.description =
      'Acordo societário';

    row.import_note =
      'Davi Alef — acordo societário.';

  } else if (
    /ademicon/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'business_debt';

    row.category_id =
      cat(
        'Consórcio',
        'Empréstimos e acordos'
      )?.id ||
      null;

    row.debt_id =
      debt(
        'Ademicon',
        'Consórcio'
      )?.id ||
      null;

    row.description =
      'Ademicon — consórcio da loja';

    row.import_note =
      'Consórcio da empresa.';

  } else if (
    /nathan/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'business_operating';

    row.category_id =
      cat(
        'Funcionários'
      )?.id ||
      null;

    row.description =
      'Pagamento funcionário — Nathan';

  } else if (
    /facebook|instagram|meta\b/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'business_operating';

    row.category_id =
      cat(
        'Marketing e publicidade'
      )?.id ||
      null;

    row.description =
      'Facebook / Meta Ads';

  } else if (
    /joao paulo/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'business_operating';

    row.category_id =
      cat(
        'Fretes e entregas'
      )?.id ||
      null;

    row.description =
      'Frete / entrega — João Paulo';

  } else if (
    /ifood|marmita|lanche|mercado|supermercado/
      .test(t) &&
    item.sign < 0
  ) {
    row.nature =
      'personal_withdrawal';

    row.category_id =
      cat(
        'Marmita',
        'Mercado pessoal',
        'Alimentação pessoal',
        'Outros pessoais'
      )?.id ||
      null;

    row.import_note =
      'Despesa pessoal.';

  } else if (
    item.sign > 0
  ) {
    row.nature =
      'income';

    row.category_id =
      cat(
        'Vendas da loja'
      )?.id ||
      null;

    row.import_note =
      'Entrada/Pix de venda.';

  } else {
    row.selected =
      false;

    row.status =
      'Revisar classificação';

    row.import_note =
      'Saída não reconhecida automaticamente.';
  }

  if (
    row.direction !==
      'transfer' &&
    !row.category_id
  ) {
    row.selected =
      false;

    row.status =
      'Categoria não encontrada';
  }

  return row;
}

function parseStatement(
  text,
  year
) {
  const lines =
    String(text)
      .replace(
        /\r/g,
        ''
      )
      .split('\n')
      .map(
        s =>
          s
            .trim()
            .replace(
              /\*\*/g,
              ''
            )
            .replace(
              /^[*•]+\s*/,
              ''
            )
            .trim()
      )
      .filter(
        s =>
          s &&
          s !== '-'
      );

  const monthNames = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    'março': 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12
  };

  const rows = [];

  let date =
    null;

  let time =
    '12:00';

  let description =
    '';

  let detail =
    '';

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    let m =
      line.match(
        /^(Hoje|Ontem)/i
      );

    if (m) {
      date =
        offsetDate(
          m[1]
            .toLowerCase() ===
            'ontem'
            ? -1
            : 0
        );

      continue;
    }

    m =
      line.match(
        /^(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i
      );

    if (
      m &&
      monthNames[
        norm(m[2])
      ]
    ) {
      date =
        `${year}-` +
        `${pad(
          monthNames[
            norm(m[2])
          ]
        )}-` +
        `${pad(
          Number(m[1])
        )}`;

      continue;
    }

    m =
      line.match(
        /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/
      );

    if (m) {
      const y =
        m[3]
          ? fixYear(
              Number(m[3])
            )
          : year;

      date =
        `${y}-` +
        `${pad(
          Number(m[2])
        )}-` +
        `${pad(
          Number(m[1])
        )}`;

      continue;
    }

    m =
      line.match(
        /^(\d{1,2})h(\d{2})$/i
      ) ||
      line.match(
        /^(\d{1,2}):(\d{2})$/
      );

    if (m) {
      time =
        `${pad(
          Number(m[1])
        )}:${m[2]}`;

      continue;
    }

    const val =
      parseValue(line);

    if (val) {
      const desc =
        description ||
        inferPreviousDescription(
          lines,
          i
        );

      rows.push(
        {
          date:
            date ||
            localDate(),

          time,

          sign:
            val.sign,

          amount_cents:
            val.cents,

          description:
            cleanDescription(
              desc
            ),

          detail
        }
      );

      description =
        '';

      detail =
        '';

      continue;
    }

    const simple =
      line.match(
        /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+([+-])\s*R?\$?\s*([\d.]+(?:,\d{1,2})?)\s+(.+)$/i
      );

    if (simple) {
      const y =
        simple[3]
          ? fixYear(
              Number(
                simple[3]
              )
            )
          : year;

      rows.push(
        {
          date:
            `${y}-` +
            `${pad(
              Number(
                simple[2]
              )
            )}-` +
            `${pad(
              Number(
                simple[1]
              )
            )}`,

          time:
            '12:00',

          sign:
            simple[4] === '+'
              ? 1
              : -1,

          amount_cents:
            moneyCents(
              simple[5]
            ),

          description:
            cleanDescription(
              simple[6]
            ),

          detail:
            ''
        }
      );

      continue;
    }

    const lineNorm =
      norm(line);

    if (
      !/^(saldo|disponivel|movimento)/
        .test(lineNorm) &&
      !/^(pix enviado|pix recebido|pagamento)$/
        .test(lineNorm)
    ) {
      if (!description) {
        description =
          line;

      } else {
        detail =
          `${detail} ${line}`
            .trim();
      }
    }
  }

  return rows.filter(
    r =>
      r.amount_cents > 0
  );
}

function parseValue(
  line
) {
  const m =
    String(line)
      .match(
        /^([+-])?\s*R\$\s*([\d.]+(?:,\d{1,2})?)$/i
      );

  if (!m) {
    return null;
  }

  return {
    sign:
      m[1] === '-'
        ? -1
        : 1,

    cents:
      moneyCents(
        m[2]
      )
  };
}

function inferPreviousDescription(
  lines,
  i
) {
  for (
    let j = i - 1;
    j >=
      Math.max(
        0,
        i - 5
      );
    j--
  ) {
    const s =
      lines[j];

    if (
      /^\d{1,2}h\d{2}$/
        .test(s) ||
      /^movimento/i
        .test(s) ||
      /^(pix enviado|pix recebido|pagamento)$/i
        .test(s)
    ) {
      continue;
    }

    if (
      !parseValue(s) &&
      !/^\d{1,2}\s+de\s+/i
        .test(s)
    ) {
      return s;
    }
  }

  return 'Movimento importado';
}

function cleanDescription(v) {
  return String(
    v ||
    'Movimento importado'
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim()
    .slice(
      0,
      180
    );
}

async function duplicate(
  db,
  row
) {
  const marker =
    `%[${TAG}:${row.fingerprint}]%`;

  const byMarker =
    await db.prepare(
      `
      SELECT
        id,
        description
      FROM transactions
      WHERE notes LIKE ?
      LIMIT 1
      `
    )
      .bind(marker)
      .first();

  if (byMarker) {
    return byMarker;
  }

  const start =
    `${row.date}T00:00:00`;

  const end =
    `${row.date}T23:59:59`;

  let q =
    `
    SELECT
      id,
      description
    FROM transactions
    WHERE status!='void'
      AND occurred_at>=?
      AND occurred_at<=?
      AND amount_cents=?
      AND direction=?
    `;

  const binds = [
    start,
    end,
    row.amount_cents,
    row.direction
  ];

  if (
    row.source_account_id
  ) {
    q +=
      ' AND source_account_id=?';

    binds.push(
      row.source_account_id
    );
  }

  if (
    row.destination_account_id
  ) {
    q +=
      ' AND destination_account_id=?';

    binds.push(
      row.destination_account_id
    );
  }

  q +=
    ' ORDER BY id DESC LIMIT 8';

  const found =
    (
      await db.prepare(q)
        .bind(...binds)
        .all()
    ).results ||
    [];

  return (
    found.find(
      x =>
        similar(
          x.description,
          row.description
        )
    ) ||
    null
  );
}

async function accounts(db) {
  const result =
    await db.prepare(
      `
      SELECT
        a.id,
        a.name,
        a.active,

        a.opening_balance_cents

        + COALESCE((
            SELECT
              SUM(t.amount_cents)
            FROM transactions t
            WHERE
              t.destination_account_id=a.id
              AND t.status!='void'
              AND COALESCE(
                t.opening_history,
                0
              )=0
          ),0)

        - COALESCE((
            SELECT
              SUM(t.amount_cents)
            FROM transactions t
            WHERE
              t.source_account_id=a.id
              AND t.status!='void'
              AND COALESCE(
                t.opening_history,
                0
              )=0
          ),0)

        + COALESCE((
            SELECT
              SUM(x.difference_cents)
            FROM account_balance_adjustments x
            WHERE
              x.account_id=a.id
          ),0)

        AS balance_cents

      FROM accounts a

      WHERE
        a.active=1

      ORDER BY
        a.name
      `
    )
      .all();

  return (
    result.results ||
    []
  );
}

async function categories(db) {
  return (
    await db.prepare(
      `
      SELECT
        id,
        name,
        nature,
        active
      FROM categories
      WHERE active=1
      ORDER BY name
      `
    )
      .all()
  ).results ||
  [];
}

async function debtRows(db) {
  return (
    await db.prepare(
      `
      SELECT
        id,
        name,
        scope,
        status
      FROM debts
      WHERE status='active'
      ORDER BY name
      `
    )
      .all()
  ).results ||
  [];
}

async function balanceOf(
  db,
  id
) {
  return (
    await accounts(db)
  ).find(
    a =>
      Number(a.id) ===
      Number(id)
  ) ||
  null;
}

function findCategory(
  cats,
  names
) {
  for (
    const n of names
  ) {
    const exact =
      cats.find(
        c =>
          norm(c.name) ===
          norm(n)
      );

    if (exact) {
      return exact;
    }
  }

  for (
    const n of names
  ) {
    const part =
      cats.find(
        c =>
          norm(c.name)
            .includes(
              norm(n)
            )
      );

    if (part) {
      return part;
    }
  }

  return null;
}

function findDebt(
  debts,
  names
) {
  for (
    const n of names
  ) {
    const d =
      debts.find(
        x =>
          norm(x.name)
            .includes(
              norm(n)
            )
      );

    if (d) {
      return d;
    }
  }

  return null;
}

function similar(
  a,
  b
) {
  const x =
    norm(a);

  const y =
    norm(b);

  return (
    x === y ||
    (
      x.length > 5 &&
      y.length > 5 &&
      (
        x.includes(y) ||
        y.includes(x)
      )
    )
  );
}

function hash(s) {
  let h =
    2166136261;

  for (
    let i = 0;
    i < s.length;
    i++
  ) {
    h ^=
      s.charCodeAt(i);

    h =
      Math.imul(
        h,
        16777619
      );
  }

  return (
    h >>> 0
  ).toString(36);
}

function norm(v) {
  return String(v || '')
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

function moneyCents(v) {
  let s =
    String(v || '')
      .replace(
        /\./g,
        ''
      )
      .replace(
        ',',
        '.'
      );

  const n =
    Number(s);

  return Number.isFinite(n)
    ? Math.round(
        n * 100
      )
    : 0;
}

function pos(
  v,
  label
) {
  const n =
    Number(v);

  if (
    !Number.isInteger(n) ||
    n <= 0
  ) {
    throw new Error(
      `${label} inválido.`
    );
  }

  return n;
}

function nullable(v) {
  const n =
    Number(v);

  return (
    Number.isInteger(n) &&
    n > 0
  )
    ? n
    : null;
}

function pad(n) {
  return String(n)
    .padStart(
      2,
      '0'
    );
}

function fixYear(y) {
  return y < 100
    ? 2000 + y
    : y;
}

function localDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        TZ,

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit'
    }
  ).format(
    new Date()
  );
}

function offsetDate(days) {
  const d =
    new Date();

  d.setUTCDate(
    d.getUTCDate() +
    days
  );

  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        TZ,

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit'
    }
  ).format(d);
}

async function readJson(req) {
  return req
    .json()
    .catch(
      () => {
        throw new Error(
          'JSON inválido.'
        );
      }
    );
}

function json(
  data,
  status = 200
) {
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

function ui() {
  return `
<style data-pf-v196>
#pfV196ImportPanel textarea{
  width:100%;
  min-height:230px;
  resize:vertical;
  padding:12px;
  border:1px solid #d9dfe8;
  border-radius:12px;
  font:inherit;
}

.pf-v196-grid{
  display:grid;
  grid-template-columns:260px 1fr;
  gap:12px;
}

.pf-v196-grid label{
  display:grid;
  gap:6px;
  font-size:10px;
  font-weight:800;
  color:#556176;
}

.pf-v196-grid select{
  padding:10px;
  border:1px solid #d9dfe8;
  border-radius:11px;
  background:#fff;
}

.pf-v196-summary{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:9px;
  margin:13px 0;
}

.pf-v196-summary>div{
  padding:11px 12px;
  border:1px solid #e4e8ef;
  border-radius:13px;
  background:#fff;
}

.pf-v196-summary span{
  display:block;
  font-size:8px;
  color:#8a94a5;
}

.pf-v196-summary strong{
  display:block;
  margin-top:3px;
  font-size:15px;
}

.pf-v196-table-wrap{
  overflow:auto;
  background:#fff;
  border:1px solid #dfe4ed;
  border-radius:18px;
}

.pf-v196-table{
  width:100%;
  border-collapse:collapse;
  min-width:980px;
}

.pf-v196-table th{
  background:#f7f9fc;
  color:#758197;
  font-size:8px;
  text-align:left;
  padding:10px;
}

.pf-v196-table td{
  padding:10px;
  border-top:1px solid #edf0f4;
  font-size:10px;
}

.pf-v196-status{
  display:inline-flex;
  padding:4px 7px;
  border-radius:999px;
  font-size:8px;
  font-weight:800;
}

.pf-v196-status.ready{
  background:#eaf8ef;
  color:#147b42;
}

.pf-v196-status.review{
  background:#fff7df;
  color:#7a5a00;
}

.pf-v196-status.duplicate{
  background:#eef1f6;
  color:#667085;
}

.pf-v196-actions{
  display:flex;
  justify-content:flex-end;
  gap:8px;
  margin-top:12px;
  flex-wrap:wrap;
}

.pf-v196-note{
  margin-top:10px;
  padding:10px 12px;
  border:1px solid #dfe4ed;
  border-radius:12px;
  background:#f8f9fc;
  color:#596579;
  font-size:10px;
  line-height:1.45;
}

@media(max-width:760px){
  .pf-v196-grid{
    grid-template-columns:1fr;
  }

  .pf-v196-summary{
    grid-template-columns:1fr 1fr;
  }
}
</style>

<script data-pf-v196>
(${client.toString()})();
</script>
`;
}

function client() {
  'use strict';

  var V =
    '1.9.6';

  var state = {
    accountId: 0,
    rows: []
  };

  function $(id) {
    return document
      .getElementById(id);
  }

  function esc(v) {
    return String(
      v == null
        ? ''
        : v
    ).replace(
      /[&<>"']/g,
      function(c) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[c];
      }
    );
  }

  function money(c) {
    return new Intl.NumberFormat(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    ).format(
      Number(c || 0) /
      100
    );
  }

  async function api(
    url,
    opt
  ) {
    var r =
      await fetch(
        url,
        {
          headers: {
            'Content-Type':
              'application/json'
          },

          ...(opt || {})
        }
      );

    var d = {};

    try {
      d =
        await r.json();

    } catch(e) {}

    if (!r.ok) {
      throw new Error(
        d.error ||
        (
          'Erro ' +
          r.status
        )
      );
    }

    return d;
  }

  function say(t) {
    var x =
      $('toast');

    if (x) {
      x.textContent =
        t;

      x.hidden =
        false;

      setTimeout(
        function() {
          x.hidden =
            true;
        },
        4200
      );

    } else {
      alert(t);
    }
  }

  function version() {
    var f =
      document.querySelector(
        '.sidebar-foot strong'
      );

    if (
      f &&
      f.textContent !==
        'v' + V
    ) {
      f.textContent =
        'v' + V;
    }

    document
      .documentElement
      .dataset
      .appVersion =
        V;
  }

  function install() {
    var view =
      $('view-conciliacao');

    var tabs =
      view &&
      view.querySelector(
        '.pf-conc-tabs'
      );

    if (
      !view ||
      !tabs
    ) {
      return false;
    }

    if (
      $('pfV196ImportPanel')
    ) {
      return true;
    }

    var tab =
      document.createElement(
        'button'
      );

    tab.type =
      'button';

    tab.dataset.concTab =
      'importar';

    tab.textContent =
      'Importar extrato';

    tabs.appendChild(tab);

    var panel =
      document.createElement(
        'section'
      );

    panel.id =
      'pfV196ImportPanel';

    panel.className =
      'pf-conc-panel';

    panel.innerHTML =
      '<article class="pf-conc-card">' +

      '<div class="pf-v196-grid">' +

      '<label>' +
      'Conta do extrato' +

      '<select id="pfV196Account">' +
      '<option>Carregando...</option>' +
      '</select>' +

      '</label>' +

      '<label>' +
      'Cole o extrato' +

      '<textarea id="pfV196Text" ' +
      'placeholder="Cole aqui o texto do Mercado Pago ou Nubank. Também aceita: 18/08 +87,00 Ana Clara">' +
      '</textarea>' +

      '</label>' +

      '</div>' +

      '<div class="pf-v196-note">' +
      '<b>Importação segura:</b> ' +
      'identifica transferências, vendas, rendimentos e despesas conhecidas; ' +
      'procura duplicados; linhas duvidosas ficam desmarcadas.' +
      '</div>' +

      '<div class="pf-v196-actions">' +

      '<button type="button" id="pfV196Clear" class="pf-conc-btn">' +
      'Limpar' +
      '</button>' +

      '<button type="button" id="pfV196Analyze" class="pf-conc-btn primary">' +
      'Analisar extrato' +
      '</button>' +

      '</div>' +

      '</article>' +

      '<div class="pf-v196-summary">' +

      '<div>' +
      '<span>Encontrados</span>' +
      '<strong id="pfV196Total">0</strong>' +
      '</div>' +

      '<div>' +
      '<span>Prontos</span>' +
      '<strong id="pfV196Ready">0</strong>' +
      '</div>' +

      '<div>' +
      '<span>Duplicados</span>' +
      '<strong id="pfV196Dup">0</strong>' +
      '</div>' +

      '<div>' +
      '<span>Revisar</span>' +
      '<strong id="pfV196Review">0</strong>' +
      '</div>' +

      '</div>' +

      '<div class="pf-v196-table-wrap">' +

      '<table class="pf-v196-table">' +

      '<thead>' +
      '<tr>' +
      '<th></th>' +
      '<th>Data</th>' +
      '<th>Descrição</th>' +
      '<th>Tipo</th>' +
      '<th>Status</th>' +
      '<th>Valor</th>' +
      '</tr>' +
      '</thead>' +

      '<tbody id="pfV196Rows">' +
      '<tr>' +
      '<td colspan="6" class="pf-conc-empty">' +
      'Cole o extrato e clique em Analisar.' +
      '</td>' +
      '</tr>' +
      '</tbody>' +

      '</table>' +

      '</div>' +

      '<div class="pf-v196-actions">' +

      '<button type="button" id="pfV196Commit" class="pf-conc-btn primary" disabled>' +
      'Importar selecionados' +
      '</button>' +

      '</div>';

    (
      view.querySelector(
        '.pf-conc-page'
      ) ||
      view
    ).appendChild(
      panel
    );

    tab.addEventListener(
      'click',
      function() {
        view.querySelectorAll(
          '[data-conc-tab]'
        ).forEach(
          function(b) {
            b.classList.toggle(
              'active',
              b === tab
            );
          }
        );

        view.querySelectorAll(
          '.pf-conc-panel'
        ).forEach(
          function(p) {
            p.classList.toggle(
              'active',
              p === panel
            );
          }
        );
      }
    );

    view.querySelectorAll(
      '[data-conc-tab]'
    ).forEach(
      function(b) {
        if (
          b !== tab
        ) {
          b.addEventListener(
            'click',
            function() {
              panel.classList.remove(
                'active'
              );
            }
          );
        }
      }
    );

    $('pfV196Analyze')
      .onclick =
        analyze;

    $('pfV196Commit')
      .onclick =
        commit;

    $('pfV196Clear')
      .onclick =
        function() {
          $('pfV196Text')
            .value =
              '';

          state.rows =
            [];

          render([]);
        };

    loadMeta();

    version();

    return true;
  }

  async function loadMeta() {
    try {
      var d =
        await api(
          '/api/v196/import-meta'
        );

      var s =
        $('pfV196Account');

      s.innerHTML =
        '<option value="">' +
        'Selecione' +
        '</option>' +

        d.accounts
          .map(
            function(a) {
              return (
                '<option value="' +
                a.id +
                '">' +
                esc(a.name) +
                ' · ' +
                money(
                  a.balance_cents
                ) +
                '</option>'
              );
            }
          )
          .join('');

      var mp =
        d.accounts.find(
          function(a) {
            return String(
              a.name
            )
              .toLowerCase()
              .indexOf(
                'mercado pago'
              ) >= 0;
          }
        );

      if (mp) {
        s.value =
          String(mp.id);
      }

    } catch(e) {
      say(
        e.message
      );
    }
  }

  async function analyze() {
    var id =
      Number(
        $('pfV196Account')
          .value ||
        0
      );

    var text =
      $('pfV196Text')
        .value
        .trim();

    if (!id) {
      return say(
        'Selecione a conta.'
      );
    }

    if (!text) {
      return say(
        'Cole o extrato.'
      );
    }

    var b =
      $('pfV196Analyze');

    b.disabled =
      true;

    b.textContent =
      'Analisando...';

    try {
      var d =
        await api(
          '/api/v196/import-preview',
          {
            method:
              'POST',

            body:
              JSON.stringify(
                {
                  account_id:
                    id,

                  text:
                    text
                }
              )
          }
        );

      state.accountId =
        id;

      state.rows =
        d.rows ||
        [];

      render(
        state.rows
      );

    } catch(e) {
      say(
        e.message
      );

    } finally {
      b.disabled =
        false;

      b.textContent =
        'Analisar extrato';
    }
  }

  function render(rows) {
    $('pfV196Total')
      .textContent =
        rows.length;

    $('pfV196Ready')
      .textContent =
        rows.filter(
          function(r) {
            return (
              r.selected &&
              !r.duplicate
            );
          }
        ).length;

    $('pfV196Dup')
      .textContent =
        rows.filter(
          function(r) {
            return (
              !!r.duplicate
            );
          }
        ).length;

    $('pfV196Review')
      .textContent =
        rows.filter(
          function(r) {
            return (
              !r.selected &&
              !r.duplicate
            );
          }
        ).length;

    var h =
      $('pfV196Rows');

    if (!rows.length) {
      h.innerHTML =
        '<tr>' +
        '<td colspan="6" class="pf-conc-empty">' +
        'Nenhum movimento.' +
        '</td>' +
        '</tr>';

      $('pfV196Commit')
        .disabled =
          true;

      return;
    }

    h.innerHTML =
      rows.map(
        function(
          r,
          i
        ) {
          var cls =
            r.status_type ||
            'ready';

          var sign =
            r.direction ===
              'income'
              ? '+'
              : r.direction ===
                  'expense'
                ? '-'
                : '↔';

          return (
            '<tr>' +

            '<td>' +
            '<input type="checkbox" data-i="' +
            i +
            '" ' +
            (
              r.selected &&
              !r.duplicate
                ? 'checked'
                : ''
            ) +
            ' ' +
            (
              r.duplicate
                ? 'disabled'
                : ''
            ) +
            '>' +
            '</td>' +

            '<td>' +
            esc(r.date) +
            '<br>' +
            '<small>' +
            esc(r.time) +
            '</small>' +
            '</td>' +

            '<td>' +
            '<b>' +
            esc(
              r.description
            ) +
            '</b>' +
            '<br>' +
            '<small>' +
            esc(
              r.import_note ||
              ''
            ) +
            '</small>' +
            '</td>' +

            '<td>' +
            esc(
              r.direction ===
                'income'
                ? 'Entrada'
                : r.direction ===
                    'expense'
                  ? 'Saída'
                  : 'Transferência'
            ) +
            '</td>' +

            '<td>' +
            '<span class="pf-v196-status ' +
            cls +
            '">' +
            esc(r.status) +
            '</span>' +
            '</td>' +

            '<td>' +
            '<b>' +
            sign +
            money(
              r.amount_cents
            ) +
            '</b>' +
            '</td>' +

            '</tr>'
          );
        }
      ).join('');

    h.querySelectorAll(
      '[data-i]'
    ).forEach(
      function(x) {
        x.onchange =
          function() {
            state.rows[
              Number(
                x.dataset.i
              )
            ].selected =
              x.checked;

            toggle();
          };
      }
    );

    toggle();
  }

  function toggle() {
    $('pfV196Commit')
      .disabled =
        !state.rows.some(
          function(r) {
            return (
              r.selected &&
              !r.duplicate
            );
          }
        );
  }

  async function commit() {
    var rows =
      state.rows.filter(
        function(r) {
          return (
            r.selected &&
            !r.duplicate
          );
        }
      );

    if (!rows.length) {
      return say(
        'Nenhum movimento selecionado.'
      );
    }

    if (
      !confirm(
        'Importar ' +
        rows.length +
        ' movimento(s)?\n\n' +
        'Duplicados serão ignorados automaticamente.'
      )
    ) {
      return;
    }

    var b =
      $('pfV196Commit');

    b.disabled =
      true;

    b.textContent =
      'Importando...';

    try {
      var d =
        await api(
          '/api/v196/import-commit',
          {
            method:
              'POST',

            body:
              JSON.stringify(
                {
                  account_id:
                    state.accountId,

                  rows:
                    rows
                }
              )
          }
        );

      alert(
        'Importação concluída.\n\n' +
        'Importados: ' +
        d.imported +
        '\n' +
        'Duplicados ignorados: ' +
        d.duplicates +
        '\n' +
        'Saldo da conta: ' +
        money(
          d.account.balance_cents
        )
      );

      location.reload();

    } catch(e) {
      say(
        e.message
      );

      b.disabled =
        false;

      b.textContent =
        'Importar selecionados';
    }
  }

  var n =
    0;

  var t =
    setInterval(
      function() {
        n++;

        version();

        if (
          install() ||
          n >= 80
        ) {
          clearInterval(t);
        }
      },
      250
    );
}
