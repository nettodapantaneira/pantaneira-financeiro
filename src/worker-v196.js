import worker194 from './worker-v194.js';

const VERSION = '1.9.6';
const TZ = 'America/Cuiaba';
const IMPORT_TAG = 'IMPORT_V196';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname === '/api/v196/import-commit' &&
        request.method === 'POST'
      ) {
        const denied = await requireAppSession(request, env, ctx);
        if (denied) return denied;
        return json(
          await commitImportedRows(
            env.DB,
            await readJson(request)
          ),
          201
        );
      }

      const response = await worker194.fetch(
        request,
        env,
        ctx
      );

      if (
        url.pathname === '/api/health' &&
        response.ok
      ) {
        const data = await response
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

      const type =
        response.headers.get('content-type') || '';

      if (
        response.ok &&
        type.includes('text/html')
      ) {
        let html = await response.text();

        if (
          !html.includes(
            'data-pf-v196-import'
          )
        ) {
          html = html.replace(
            '</body>',
            `${importUi()}</body>`
          );
        }

        const headers =
          new Headers(response.headers);

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

        return new Response(
          html,
          {
            status:
              response.status,

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
        url.pathname.startsWith(
          '/api/'
        )
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

async function requireAppSession(
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
    await worker194.fetch(
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

async function commitImportedRows(
  db,
  body
) {
  const selectedAccountId =
    positiveInt(
      body.account_id,
      'Conta'
    );

  const rows =
    Array.isArray(
      body.rows
    )
      ? body.rows
      : [];

  if (!rows.length) {
    throw new Error(
      'Nenhum lançamento selecionado.'
    );
  }

  if (
    rows.length > 100
  ) {
    throw new Error(
      'Importe no máximo 100 lançamentos por vez.'
    );
  }

  const selectedAccount =
    await db.prepare(
      'SELECT id,name,active FROM accounts WHERE id=?'
    )
      .bind(
        selectedAccountId
      )
      .first();

  if (
    !selectedAccount ||
    !Number(
      selectedAccount.active
    )
  ) {
    throw new Error(
      'Conta selecionada inválida.'
    );
  }

  const result = {
    ok: true,
    imported: 0,
    duplicates: 0,
    errors: [],
    ids: []
  };

  for (
    const raw of rows
  ) {
    try {
      const row =
        await validateImportRow(
          db,
          raw,
          selectedAccountId
        );

      const duplicate =
        await findDuplicate(
          db,
          row
        );

      if (duplicate) {
        result.duplicates += 1;
        continue;
      }

      const fingerprint =
        importFingerprint(
          row
        );

      const notes = [
        `[${IMPORT_TAG}:${fingerprint}]`,
        'Importado em lote pela Conciliação v1.9.6.',
        row.import_note || ''
      ]
        .filter(Boolean)
        .join(' ');

      const occurredAt =
        `${row.date}T${row.time}:00-04:00`;

      const created =
        await db.prepare(`
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
            ?,?,?,?,?,
            'posted',
            0
          )
        `)
          .bind(
            occurredAt,
            row.date.slice(
              0,
              7
            ),
            row.direction,
            row.amount_cents,
            row.source_account_id,
            row.destination_account_id,
            row.nature,
            row.category_id,
            row.debt_id,
            row.description,
            notes,
            row.payment_method,
            'eventual'
          )
          .run();

      const transactionId =
        Number(
          created.meta.last_row_id
        );

      if (
        row.debt_id &&
        row.direction ===
          'expense'
      ) {
        await applyDebtPayment(
          db,
          row.debt_id,
          row.amount_cents
        );
      }

      const after =
        await db.prepare(
          'SELECT * FROM transactions WHERE id=?'
        )
          .bind(
            transactionId
          )
          .first();

      await db.prepare(`
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
      `)
        .bind(
          transactionId,
          JSON.stringify(
            after
          )
        )
        .run()
        .catch(
          () => null
        );

      result.imported += 1;

      result.ids.push(
        transactionId
      );

    } catch (error) {
      result.errors.push(
        {
          description:
            String(
              raw?.description ||
              'Lançamento'
            ),

          error:
            String(
              error?.message ||
              error
            )
        }
      );
    }
  }

  const balance =
    await calculateAccountBalance(
      db,
      selectedAccountId
    );

  result.account = {
    id:
      selectedAccountId,

    name:
      selectedAccount.name,

    balance_cents:
      Number(
        balance?.balance_cents ||
        0
      )
  };

  return result;
}

async function validateImportRow(
  db,
  raw,
  selectedAccountId
) {
  const date =
    String(
      raw?.date ||
      ''
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(date)
  ) {
    throw new Error(
      'Data inválida.'
    );
  }

  const time =
    /^\d{2}:\d{2}$/
      .test(
        String(
          raw?.time ||
          ''
        )
      )
      ? String(
          raw.time
        )
      : '12:00';

  const direction =
    [
      'income',
      'expense',
      'transfer'
    ].includes(
      raw?.direction
    )
      ? raw.direction
      : null;

  if (!direction) {
    throw new Error(
      'Tipo de lançamento inválido.'
    );
  }

  const amountCents =
    positiveInt(
      raw?.amount_cents,
      'Valor'
    );

  const description =
    textRequired(
      raw?.description,
      'Descrição'
    );

  const paymentMethod =
    normalizePaymentMethod(
      raw?.payment_method
    );

  let nature =
    String(
      raw?.nature ||
      ''
    );

  let categoryId =
    nullablePositiveInt(
      raw?.category_id
    );

  let debtId =
    nullablePositiveInt(
      raw?.debt_id
    );

  let sourceAccountId =
    nullablePositiveInt(
      raw?.source_account_id
    );

  let destinationAccountId =
    nullablePositiveInt(
      raw?.destination_account_id
    );

  if (
    direction ===
    'income'
  ) {
    nature =
      'income';

    sourceAccountId =
      null;

    destinationAccountId =
      destinationAccountId ||
      selectedAccountId;

    debtId =
      null;
  }

  if (
    direction ===
    'expense'
  ) {
    if (
      ![
        'business_operating',
        'inventory',
        'business_debt',
        'personal_withdrawal'
      ].includes(
        nature
      )
    ) {
      throw new Error(
        'Natureza da saída inválida.'
      );
    }

    sourceAccountId =
      sourceAccountId ||
      selectedAccountId;

    destinationAccountId =
      null;
  }

  if (
    direction ===
    'transfer'
  ) {
    nature =
      'transfer';

    categoryId =
      null;

    debtId =
      null;

    if (
      !sourceAccountId &&
      !destinationAccountId
    ) {
      throw new Error(
        'Transferência sem conta de origem ou destino.'
      );
    }
  }

  if (
    sourceAccountId
  ) {
    await assertAccount(
      db,
      sourceAccountId
    );
  }

  if (
    destinationAccountId
  ) {
    await assertAccount(
      db,
      destinationAccountId
    );
  }

  if (
    direction !==
    'transfer'
  ) {
    if (
      !categoryId
    ) {
      throw new Error(
        'Escolha uma categoria.'
      );
    }

    const category =
      await db.prepare(
        'SELECT id,nature,active FROM categories WHERE id=?'
      )
        .bind(
          categoryId
        )
        .first();

    if (
      !category ||
      !Number(
        category.active
      )
    ) {
      throw new Error(
        'Categoria inválida ou inativa.'
      );
    }

    if (
      String(
        category.nature
      ) !==
      nature
    ) {
      throw new Error(
        'Categoria incompatível com a natureza do lançamento.'
      );
    }
  }

  if (
    debtId
  ) {
    const debt =
      await db.prepare(
        'SELECT id,status FROM debts WHERE id=?'
      )
        .bind(
          debtId
        )
        .first();

    if (
      !debt ||
      debt.status ===
        'paid'
    ) {
      throw new Error(
        'Dívida inválida ou já quitada.'
      );
    }
  }

  return {
    date,
    time,
    direction,

    amount_cents:
      amountCents,

    description,
    nature,

    category_id:
      categoryId,

    debt_id:
      debtId,

    source_account_id:
      sourceAccountId,

    destination_account_id:
      destinationAccountId,

    payment_method:
      paymentMethod,

    import_note:
      String(
        raw?.import_note ||
        ''
      ).trim()
  };
}

async function assertAccount(
  db,
  id
) {
  const account =
    await db.prepare(
      'SELECT id,active FROM accounts WHERE id=?'
    )
      .bind(
        Number(id)
      )
      .first();

  if (
    !account ||
    !Number(
      account.active
    )
  ) {
    throw new Error(
      'Conta de origem/destino inválida.'
    );
  }
}

async function applyDebtPayment(
  db,
  debtId,
  amountCents
) {
  const debt =
    await db.prepare(
      'SELECT id,current_balance_cents FROM debts WHERE id=?'
    )
      .bind(
        debtId
      )
      .first();

  if (
    !debt ||
    debt.current_balance_cents ==
      null
  ) {
    return;
  }

  const next =
    Math.max(
      0,
      Number(
        debt.current_balance_cents ||
        0
      ) -
      Number(
        amountCents ||
        0
      )
    );

  await db.prepare(`
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
  `)
    .bind(
      next,
      next,
      debtId
    )
    .run();
}

async function findDuplicate(
  db,
  row
) {
  const fingerprint =
    importFingerprint(
      row
    );

  const marked =
    await db.prepare(`
      SELECT
        id,
        description
      FROM transactions
      WHERE notes LIKE ?
      LIMIT 1
    `)
      .bind(
        `%[${IMPORT_TAG}:${fingerprint}]%`
      )
      .first();

  if (marked) {
    return marked;
  }

  let sql = `
    SELECT
      id,
      description,
      source_account_id,
      destination_account_id
    FROM transactions
    WHERE
      status!='void'
      AND substr(
        occurred_at,
        1,
        10
      )=?
      AND direction=?
      AND amount_cents=?
  `;

  const binds = [
    row.date,
    row.direction,
    row.amount_cents
  ];

  if (
    row.source_account_id
  ) {
    sql +=
      ' AND source_account_id=?';

    binds.push(
      row.source_account_id
    );

  } else {
    sql +=
      ' AND source_account_id IS NULL';
  }

  if (
    row.destination_account_id
  ) {
    sql +=
      ' AND destination_account_id=?';

    binds.push(
      row.destination_account_id
    );

  } else {
    sql +=
      ' AND destination_account_id IS NULL';
  }

  sql +=
    ' ORDER BY id DESC LIMIT 20';

  const candidates =
    (
      await db.prepare(sql)
        .bind(
          ...binds
        )
        .all()
    ).results ||
    [];

  return (
    candidates.find(
      item =>
        similarText(
          item.description,
          row.description
        )
    ) ||
    null
  );
}

async function calculateAccountBalance(
  db,
  accountId
) {
  return db.prepare(`
    SELECT
      a.id,
      a.name,

      a.opening_balance_cents

      + COALESCE((
          SELECT
            SUM(
              t.amount_cents
            )
          FROM transactions t
          WHERE
            t.destination_account_id=
              a.id
            AND
            t.status!='void'
            AND
            COALESCE(
              t.opening_history,
              0
            )=0
        ),0)

      - COALESCE((
          SELECT
            SUM(
              t.amount_cents
            )
          FROM transactions t
          WHERE
            t.source_account_id=
              a.id
            AND
            t.status!='void'
            AND
            COALESCE(
              t.opening_history,
              0
            )=0
        ),0)

      + COALESCE((
          SELECT
            SUM(
              x.difference_cents
            )
          FROM
            account_balance_adjustments x
          WHERE
            x.account_id=
              a.id
        ),0)

      AS balance_cents

    FROM accounts a
    WHERE a.id=?
  `)
    .bind(
      accountId
    )
    .first();
}

function importFingerprint(
  row
) {
  return hashString(
    [
      row.date,
      row.time,
      row.direction,
      row.amount_cents,
      row.source_account_id ||
        '',
      row.destination_account_id ||
        '',
      normalizeText(
        row.description
      )
    ].join('|')
  );
}

function hashString(
  value
) {
  const text =
    String(
      value ||
      ''
    );

  let hash =
    2166136261;

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    hash ^=
      text.charCodeAt(i);

    hash =
      Math.imul(
        hash,
        16777619
      );
  }

  return (
    hash >>> 0
  ).toString(36);
}

function similarText(
  a,
  b
) {
  const x =
    normalizeText(a);

  const y =
    normalizeText(b);

  return (
    x === y ||
    (
      x.length >= 6 &&
      y.length >= 6 &&
      (
        x.includes(y) ||
        y.includes(x)
      )
    )
  );
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

function normalizePaymentMethod(
  value
) {
  const method =
    String(
      value ||
      'other'
    );

  return [
    'pix',
    'cash',
    'debit',
    'credit',
    'transfer',
    'boleto',
    'other'
  ].includes(method)
    ? method
    : 'other';
}

function positiveInt(
  value,
  label
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    ) ||
    number <= 0
  ) {
    throw new Error(
      `${label} inválido.`
    );
  }

  return number;
}

function nullablePositiveInt(
  value
) {
  const number =
    Number(value);

  return (
    Number.isInteger(
      number
    ) &&
    number > 0
  )
    ? number
    : null;
}

function textRequired(
  value,
  label
) {
  const text =
    String(
      value ||
      ''
    ).trim();

  if (!text) {
    throw new Error(
      `${label} obrigatório.`
    );
  }

  return text.slice(
    0,
    180
  );
}

async function readJson(
  request
) {
  return request
    .json()
    .catch(
      () => {
        throw new Error(
          'Dados inválidos.'
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

function importUi() {
  return `
<style data-pf-v196-import>
  .pf196-tab-panel{
    display:none
  }

  .pf196-tab-panel.active{
    display:block
  }

  .pf196-card{
    background:#fff;
    border:1px solid #dfe4ed;
    border-radius:18px;
    padding:16px;
    box-shadow:0 5px 16px rgba(27,39,65,.035)
  }

  .pf196-grid{
    display:grid;
    grid-template-columns:260px minmax(0,1fr);
    gap:12px
  }

  .pf196-field{
    display:grid;
    gap:5px;
    font-size:10px;
    font-weight:800;
    color:#556176
  }

  .pf196-field select,
  .pf196-field textarea,
  .pf196-field input{
    width:100%;
    padding:10px 11px;
    border:1px solid #d9dfe8;
    border-radius:11px;
    background:#fff;
    color:#172136
  }

  .pf196-field textarea{
    min-height:220px;
    resize:vertical;
    font-family:inherit;
    line-height:1.45
  }

  .pf196-actions{
    display:flex;
    justify-content:flex-end;
    gap:8px;
    flex-wrap:wrap;
    margin-top:12px
  }

  .pf196-btn{
    border:1px solid #dbe1e9;
    border-radius:10px;
    padding:9px 13px;
    background:#fff;
    color:#33405a;
    font-weight:800;
    cursor:pointer
  }

  .pf196-btn.primary{
    border-color:#4057e8;
    background:#4057e8;
    color:#fff
  }

  .pf196-btn:disabled{
    opacity:.5;
    cursor:not-allowed
  }

  .pf196-note{
    margin-top:10px;
    padding:10px 12px;
    border:1px solid #dfe4ed;
    border-radius:12px;
    background:#f8f9fc;
    color:#596579;
    font-size:10px;
    line-height:1.45
  }

  .pf196-summary{
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:9px;
    margin:13px 0
  }

  .pf196-summary>div{
    padding:11px 12px;
    border:1px solid #e4e8ef;
    border-radius:13px;
    background:#fff
  }

  .pf196-summary span{
    display:block;
    color:#8a94a5;
    font-size:8px;
    font-weight:750;
    text-transform:uppercase;
    letter-spacing:.08em
  }

  .pf196-summary strong{
    display:block;
    margin-top:3px;
    font-size:15px;
    color:#172136
  }

  .pf196-table-wrap{
    overflow:auto;
    background:#fff;
    border:1px solid #dfe4ed;
    border-radius:18px
  }

  .pf196-table{
    width:100%;
    border-collapse:collapse;
    min-width:1180px
  }

  .pf196-table th{
    background:#f7f9fc;
    color:#758197;
    font-size:8px;
    text-align:left;
    padding:9px;
    border-bottom:1px solid #e4e8ef
  }

  .pf196-table td{
    padding:8px;
    border-bottom:1px solid #edf0f4;
    font-size:9px;
    vertical-align:middle
  }

  .pf196-table input[type="text"],
  .pf196-table input[type="date"],
  .pf196-table input[type="time"],
  .pf196-table select{
    width:100%;
    min-width:105px;
    padding:7px 8px;
    border:1px solid #dce1e9;
    border-radius:8px;
    background:#fff;
    font-size:9px
  }

  .pf196-table .desc{
    min-width:230px
  }

  .pf196-money{
    font-weight:850;
    white-space:nowrap
  }

  .pf196-status{
    display:inline-flex;
    padding:4px 7px;
    border-radius:999px;
    font-size:8px;
    font-weight:850;
    white-space:nowrap
  }

  .pf196-status.ready{
    background:#eaf8ef;
    color:#147b42
  }

  .pf196-status.review{
    background:#fff7df;
    color:#765900
  }

  .pf196-status.blocked{
    background:#fff0ef;
    color:#b64038
  }

  .pf196-help{
    margin:0 0 8px;
    color:#7d889a;
    font-size:10px
  }

  @media(max-width:760px){
    .pf196-grid{
      grid-template-columns:1fr
    }

    .pf196-summary{
      grid-template-columns:1fr 1fr
    }
  }
</style>

<script data-pf-v196-import>
(${clientImportUi.toString()})();
</script>`;
}

function clientImportUi() {
  'use strict';

  const VERSION =
    '1.9.6';

  const MONTHS = {
    janeiro:1,
    fevereiro:2,
    marco:3,
    março:3,
    abril:4,
    maio:5,
    junho:6,
    julho:7,
    agosto:8,
    setembro:9,
    outubro:10,
    novembro:11,
    dezembro:12
  };

  const state = {
    accounts: [],
    categories: [],
    debts: [],
    rows: [],
    selectedAccountId: 0
  };

  const $ =
    id =>
      document.getElementById(
        id
      );

  function esc(value) {
    return String(
      value ??
      ''
    )
      .replace(
        /[&<>"']/g,
        c => ({
          '&':'&amp;',
          '<':'&lt;',
          '>':'&gt;',
          '"':'&quot;',
          "'":'&#39;'
        })[c]
      );
  }

  function norm(value) {
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

  function money(cents) {
    return new Intl.NumberFormat(
      'pt-BR',
      {
        style:'currency',
        currency:'BRL'
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

  function parseMoney(value) {
    let s =
      String(
        value ||
        ''
      )
        .trim()
        .replace(
          /R\$/gi,
          ''
        )
        .replace(
          /\s/g,
          ''
        );

    if (!s) {
      return 0;
    }

    if (
      s.includes(',') &&
      s.includes('.')
    ) {
      s =
        s
          .replace(
            /\./g,
            ''
          )
          .replace(
            ',',
            '.'
          );

    } else if (
      s.includes(',')
    ) {
      s =
        s.replace(
          ',',
          '.'
        );

    } else if (
      (
        s.match(/\./g) ||
        []
      ).length > 1
    ) {
      s =
        s.replace(
          /\./g,
          ''
        );
    }

    const n =
      Number(s);

    return Number.isFinite(n)
      ? Math.round(
          n * 100
        )
      : 0;
  }

  function localDate() {
    return new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'America/Cuiaba',

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

  function dateOffset(days) {
    const d =
      new Date();

    d.setDate(
      d.getDate() +
      days
    );

    return new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'America/Cuiaba',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit'
      }
    ).format(d);
  }

  function toIsoDate(
    day,
    month,
    year
  ) {
    const y =
      Number(
        year ||
        localDate().slice(
          0,
          4
        )
      );

    const m =
      Number(month);

    const d =
      Number(day);

    if (
      !y ||
      m < 1 ||
      m > 12 ||
      d < 1 ||
      d > 31
    ) {
      return null;
    }

    return (
      `${y}-` +
      `${String(m).padStart(2,'0')}-` +
      `${String(d).padStart(2,'0')}`
    );
  }

  async function api(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        {
          headers:{
            'Content-Type':
              'application/json',

            ...(
              options.headers ||
              {}
            )
          },

          ...options
        }
      );

    let data = {};

    try {
      data =
        await response.json();

    } catch {}

    if (
      !response.ok
    ) {
      throw new Error(
        data.error ||
        `Erro ${response.status}`
      );
    }

    return data;
  }

  function toast(message) {
    const el =
      $('toast');

    if (!el) {
      return alert(
        message
      );
    }

    el.textContent =
      message;

    el.hidden =
      false;

    clearTimeout(
      window.__pf196Toast
    );

    window.__pf196Toast =
      setTimeout(
        () => {
          el.hidden =
            true;
        },
        4200
      );
  }

  function applyVersion() {
    const footer =
      document.querySelector(
        '.sidebar-foot strong'
      );

    if (
      footer &&
      footer.textContent !==
        `v${VERSION}`
    ) {
      footer.textContent =
        `v${VERSION}`;
    }

    document
      .documentElement
      .dataset
      .appVersion =
        VERSION;

    window
      .PANTANEIRA_FINANCEIRO_VERSION =
        VERSION;
  }

  function install() {
    const view =
      $('view-conciliacao');

    if (!view) {
      return false;
    }

    const tabs =
      view.querySelector(
        '.pf-conc-tabs'
      );

    const page =
      view.querySelector(
        '.pf-conc-page'
      ) ||
      view;

    if (
      !tabs ||
      !page
    ) {
      return false;
    }

    if (
      $('pf196ImportPanel')
    ) {
      return true;
    }

    const tab =
      document.createElement(
        'button'
      );

    tab.type =
      'button';

    tab.textContent =
      'Importar / lote';

    tab.dataset.pf196Tab =
      '1';

    tabs.appendChild(
      tab
    );

    const panel =
      document.createElement(
        'section'
      );

    panel.id =
      'pf196ImportPanel';

    panel.className =
      'pf196-tab-panel';

    panel.innerHTML = `
      <article class="pf196-card">

        <p class="pf196-help">
          <b>
            Cole o extrato do banco ou use uma linha por movimento.
          </b>
          Ex.: 18/08 +87,00 venda Ana Clara · 18/08 -30,00 Facebook.
        </p>

        <div class="pf196-grid">

          <label class="pf196-field">

            Conta do extrato

            <select id="pf196Account">
              <option value="">
                Carregando...
              </option>
            </select>

          </label>

          <label class="pf196-field">

            Extrato / lançamentos

            <textarea
              id="pf196Text"
              placeholder="Cole aqui o texto do Mercado Pago/Nubank ou linhas simples..."
            ></textarea>

          </label>

        </div>

        <div class="pf196-note">
          <b>Seguro:</b>
          nada é gravado ao clicar em Analisar.
          Você confere a prévia e só depois usa
          <b>Importar selecionados</b>.
          Pagamento de fatura fica bloqueado
          para não duplicar o módulo
          Cartões e faturas.
        </div>

        <div class="pf196-actions">

          <button
            type="button"
            id="pf196Clear"
            class="pf196-btn"
          >
            Limpar
          </button>

          <button
            type="button"
            id="pf196Analyze"
            class="pf196-btn primary"
          >
            Analisar
          </button>

        </div>

      </article>

      <div class="pf196-summary">

        <div>
          <span>
            Encontrados
          </span>

          <strong id="pf196Found">
            0
          </strong>
        </div>

        <div>
          <span>
            Selecionados
          </span>

          <strong id="pf196Selected">
            0
          </strong>
        </div>

        <div>
          <span>
            Revisar
          </span>

          <strong id="pf196Review">
            0
          </strong>
        </div>

        <div>
          <span>
            Valor líquido
          </span>

          <strong id="pf196Net">
            R$ 0,00
          </strong>
        </div>

      </div>

      <div class="pf196-table-wrap">

        <table class="pf196-table">

          <thead>
            <tr>
              <th></th>
              <th>Data</th>
              <th>Hora</th>
              <th>Descrição</th>
              <th>Tipo</th>
              <th>Classificação</th>
              <th>Categoria</th>
              <th>Conta relacionada</th>
              <th>Status</th>
              <th>Valor</th>
            </tr>
          </thead>

          <tbody id="pf196Rows">

            <tr>
              <td
                colspan="10"
                style="padding:20px;text-align:center;color:#7d889a"
              >
                Cole os movimentos e clique em Analisar.
              </td>
            </tr>

          </tbody>

        </table>

      </div>

      <div class="pf196-actions">

        <button
          type="button"
          id="pf196Commit"
          class="pf196-btn primary"
          disabled
        >
          Importar selecionados
        </button>

      </div>
    `;

    page.appendChild(
      panel
    );

    tab.addEventListener(
      'click',
      () => {
        view.querySelectorAll(
          '.pf-conc-panel'
        )
          .forEach(
            p =>
              p.classList.remove(
                'active'
              )
          );

        view.querySelectorAll(
          '.pf196-tab-panel'
        )
          .forEach(
            p =>
              p.classList.remove(
                'active'
              )
          );

        view.querySelectorAll(
          '.pf-conc-tabs button'
        )
          .forEach(
            b =>
              b.classList.remove(
                'active'
              )
          );

        panel.classList.add(
          'active'
        );

        tab.classList.add(
          'active'
        );
      }
    );

    view.querySelectorAll(
      '.pf-conc-tabs button'
    )
      .forEach(
        button => {
          if (
            button ===
            tab
          ) {
            return;
          }

          button.addEventListener(
            'click',
            () => {
              panel.classList.remove(
                'active'
              );

              tab.classList.remove(
                'active'
              );
            }
          );
        }
      );

    $('pf196Analyze')
      .addEventListener(
        'click',
        analyze
      );

    $('pf196Commit')
      .addEventListener(
        'click',
        commit
      );

    $('pf196Clear')
      .addEventListener(
        'click',
        () => {
          $('pf196Text')
            .value =
              '';

          state.rows =
            [];

          render();
        }
      );

    loadCatalogs();

    return true;
  }

  async function loadCatalogs() {
    try {
      const [
        accountsData,
        categoriesData,
        debtsData
      ] =
        await Promise.all(
          [
            api(
              '/api/accounts'
            ),

            api(
              '/api/categories?all=1'
            ),

            api(
              '/api/debts'
            )
          ]
        );

      state.accounts =
        accountsData.accounts ||
        [];

      state.categories =
        categoriesData.categories ||
        [];

      state.debts =
        debtsData.debts ||
        [];

      const select =
        $('pf196Account');

      if (!select) {
        return;
      }

      select.innerHTML =
        '<option value="">Selecione</option>' +
        state.accounts
          .map(
            a =>
              `<option value="${a.id}">${esc(a.name)} · ${money(a.balance_cents)}</option>`
          )
          .join('');

      const mp =
        state.accounts.find(
          a =>
            norm(
              a.name
            ).includes(
              'mercado pago'
            )
        );

      if (mp) {
        select.value =
          String(
            mp.id
          );
      }

    } catch (error) {
      toast(
        error.message
      );
    }
  }

  function analyze() {
    const accountId =
      Number(
        $('pf196Account')
          .value ||
        0
      );

    const text =
      $('pf196Text')
        .value
        .trim();

    if (!accountId) {
      return toast(
        'Selecione a conta do extrato.'
      );
    }

    if (!text) {
      return toast(
        'Cole o extrato ou os lançamentos.'
      );
    }

    const account =
      state.accounts.find(
        a =>
          Number(a.id) ===
          accountId
      );

    if (!account) {
      return toast(
        'Conta não encontrada.'
      );
    }

    const parsed =
      parseStatement(
        text
      );

    if (!parsed.length) {
      return toast(
        'Não encontrei movimentos no texto colado.'
      );
    }

    state.selectedAccountId =
      accountId;

    state.rows =
      parsed.map(
        item =>
          classify(
            item,
            account
          )
      );

    render();
  }

  function parseStatement(text) {
    const lines =
      String(text)
        .replace(
          /\r/g,
          ''
        )
        .split(
          '\n'
        )
        .map(
          line =>
            line
              .replace(
                /\*\*/g,
                ''
              )
              .replace(
                /^[-*•]+\s*/,
                ''
              )
              .trim()
        )
        .filter(Boolean);

    const rows = [];

    let currentDate =
      localDate();

    let currentTime =
      '12:00';

    let lastDescription =
      '';

    let detail =
      '';

    for (
      let i = 0;
      i < lines.length;
      i += 1
    ) {
      const line =
        lines[i];

      const normalized =
        norm(line);

      const simple =
        parseSimpleLine(
          line
        );

      if (simple) {
        rows.push(
          simple
        );

        continue;
      }

      if (
        normalized ===
          'hoje' ||
        normalized.startsWith(
          'hoje '
        )
      ) {
        currentDate =
          localDate();

        lastDescription =
          '';

        detail =
          '';

        continue;
      }

      if (
        normalized ===
          'ontem' ||
        normalized.startsWith(
          'ontem '
        )
      ) {
        currentDate =
          dateOffset(-1);

        lastDescription =
          '';

        detail =
          '';

        continue;
      }

      let match =
        line.match(
          /^(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)/i
        );

      if (match) {
        const month =
          MONTHS[
            norm(
              match[2]
            )
          ];

        if (month) {
          currentDate =
            toIsoDate(
              Number(
                match[1]
              ),
              month,
              Number(
                localDate().slice(
                  0,
                  4
                )
              )
            );

          lastDescription =
            '';

          detail =
            '';

          continue;
        }
      }

      match =
        line.match(
          /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/
        );

      if (match) {
        let year =
          match[3]
            ? Number(
                match[3]
              )
            : Number(
                localDate().slice(
                  0,
                  4
                )
              );

        if (
          year < 100
        ) {
          year +=
            2000;
        }

        currentDate =
          toIsoDate(
            Number(
              match[1]
            ),
            Number(
              match[2]
            ),
            year
          ) ||
          currentDate;

        lastDescription =
          '';

        detail =
          '';

        continue;
      }

      match =
        line.match(
          /^(\d{1,2})h(\d{2})$/i
        ) ||
        line.match(
          /^(\d{1,2}):(\d{2})$/
        );

      if (match) {
        currentTime =
          `${String(
            Number(
              match[1]
            )
          ).padStart(
            2,
            '0'
          )}:${match[2]}`;

        continue;
      }

      const amount =
        parseSignedAmount(
          line
        );

      if (amount) {
        const description =
          cleanDescription(
            lastDescription ||
            'Movimento importado'
          );

        rows.push(
          {
            date:
              currentDate,

            time:
              currentTime,

            sign:
              amount.sign,

            amount_cents:
              amount.cents,

            description,

            detail
          }
        );

        lastDescription =
          '';

        detail =
          '';

        continue;
      }

      if (
        /^(saldo|disponivel|movimento\s+\.\.\.|movimento\s)/
          .test(
            normalized
          ) ||
        /^(pix enviado|pix recebido|pagamento|debito|credito|boleto)$/
          .test(
            normalized
          ) ||
        normalized.includes(
          'saldo do dia'
        )
      ) {
        continue;
      }

      if (
        line.length <= 180
      ) {
        if (
          !lastDescription ||
          norm(
            lastDescription
          ) ===
            normalized
        ) {
          lastDescription =
            line;

        } else {
          detail =
            `${detail} ${line}`
              .trim();

          lastDescription =
            line;
        }
      }
    }

    return rows.filter(
      row =>
        row.date &&
        row.amount_cents >
          0
    );
  }

  function parseSimpleLine(
    line
  ) {
    const match =
      String(line)
        .match(
          /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+([+-])\s*(?:R\$\s*)?([\d.]+(?:,\d{1,2})?)\s+(.+)$/i
        );

    if (!match) {
      return null;
    }

    let year =
      match[3]
        ? Number(
            match[3]
          )
        : Number(
            localDate().slice(
              0,
              4
            )
          );

    if (
      year < 100
    ) {
      year +=
        2000;
    }

    return {
      date:
        toIsoDate(
          Number(
            match[1]
          ),
          Number(
            match[2]
          ),
          year
        ),

      time:
        '12:00',

      sign:
        match[4] ===
          '+'
          ? 1
          : -1,

      amount_cents:
        parseMoney(
          match[5]
        ),

      description:
        cleanDescription(
          match[6]
        ),

      detail:
        ''
    };
  }

  function parseSignedAmount(
    line
  ) {
    const match =
      String(line)
        .match(
          /^([+-])\s*R\$\s*([\d.]+(?:,\d{1,2})?)$/i
        );

    if (!match) {
      return null;
    }

    const cents =
      parseMoney(
        match[2]
      );

    return cents > 0
      ? {
          sign:
            match[1] ===
              '+'
              ? 1
              : -1,

          cents
        }
      : null;
  }

  function cleanDescription(
    value
  ) {
    return String(
      value ||
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

  function classify(
    item,
    account
  ) {
    const text =
      norm(
        `${item.description} ${item.detail || ''}`
      );

    const row = {
      ...item,

      selected:
        true,

      locked:
        false,

      status:
        'Pronto',

      statusType:
        'ready',

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
          ? Number(
              account.id
            )
          : null,

      destination_account_id:
        item.sign > 0
          ? Number(
              account.id
            )
          : null,

      payment_method:
        inferPaymentMethod(
          text
        ),

      import_note:
        ''
    };

    const category =
      (...names) =>
        findCategory(
          names
        );

    const debt =
      (...names) =>
        findDebt(
          names
        );

    const relatedAccount =
      name =>
        state.accounts.find(
          a =>
            Number(
              a.id
            ) !==
              Number(
                account.id
              ) &&
            norm(
              a.name
            ).includes(
              norm(name)
            )
        );

    if (
      /rendimento|cdi/
        .test(text)
    ) {
      row.direction =
        'income';

      row.nature =
        'income';

      row.category_id =
        category(
          'Rendimentos financeiros',
          'Outras receitas'
        )?.id ||
        categoryByNature(
          'income'
        )?.id ||
        null;

      row.description =
        'Rendimentos financeiros';

      row.payment_method =
        'other';

      row.import_note =
        'Rendimento/CDI; não é venda.';
    }

    else if (
      /cartao de credito/
        .test(text) &&
      /pagamento/
        .test(text)
    ) {
      row.selected =
        false;

      row.locked =
        true;

      row.status =
        'Usar Cartões e faturas';

      row.statusType =
        'blocked';

      row.import_note =
        'Pagamento de fatura não deve ser lançado novamente aqui.';
    }

    else if (
      /linha de credito|emprestimo pessoal|deposito do emprestimo/
        .test(text)
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
        Number(
          account.id
        );

      row.payment_method =
        'transfer';

      row.description =
        'Entrada de linha de crédito';

      row.import_note =
        'Capital de giro/financiamento; não entra como faturamento.';
    }

    else if (
      /liberacao de dinheiro/
        .test(text)
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
        Number(
          account.id
        );

      row.payment_method =
        'transfer';

      row.description =
        'Liberação de dinheiro';

      row.selected =
        false;

      row.status =
        'Revisar liberação';

      row.statusType =
        'review';

      row.import_note =
        'Marque somente se esta liberação ainda não estiver refletida por uma venda já lançada.';
    }

    else if (
      /gerson lafayette|gerson bastos|transferencia.*nubank|transferencia.*mercado pago|nubank.*transferencia|mercado pago.*transferencia/
        .test(text)
    ) {
      const mp =
        relatedAccount(
          'Mercado Pago'
        );

      const nubank =
        relatedAccount(
          'Nubank'
        );

      const counterpart =
        norm(
          account.name
        ).includes(
          'mercado pago'
        )
          ? nubank
          : norm(
              account.name
            ).includes(
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
              account.id
            );

          row.destination_account_id =
            Number(
              counterpart.id
            );

          row.description =
            `${account.name} → ${counterpart.name}`;

        } else {
          row.source_account_id =
            Number(
              counterpart.id
            );

          row.destination_account_id =
            Number(
              account.id
            );

          row.description =
            `${counterpart.name} → ${account.name}`;
        }

        row.import_note =
          'Transferência entre contas próprias; não é receita nem despesa.';

      } else {
        row.selected =
          false;

        row.status =
          'Revisar transferência';

        row.statusType =
          'review';
      }
    }

    else if (
      /davi alef/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'business_debt';

      row.category_id =
        category(
          'Empréstimos e acordos',
          'Acordos e financiamentos'
        )?.id ||
        categoryByNature(
          'business_debt'
        )?.id ||
        null;

      row.debt_id =
        debt(
          'Acordo societário',
          'Elaine'
        )?.id ||
        null;

      row.description =
        'Acordo societário — Davi Alef';

      row.import_note =
        'Pagamento do acordo societário.';
    }

    else if (
      /ademicon/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'business_debt';

      row.category_id =
        category(
          'Empréstimos e acordos',
          'Acordos e financiamentos'
        )?.id ||
        categoryByNature(
          'business_debt'
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

      row.payment_method =
        text.includes(
          'boleto'
        )
          ? 'boleto'
          : row.payment_method;

      row.import_note =
        'Consórcio contratado para a loja.';
    }

    else if (
      /nathan/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'business_operating';

      row.category_id =
        category(
          'Funcionários'
        )?.id ||
        categoryByNature(
          'business_operating'
        )?.id ||
        null;

      row.description =
        'Pagamento funcionário — Nathan';

      row.import_note =
        'Despesa com funcionário.';
    }

    else if (
      /facebook|instagram|meta\b/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'business_operating';

      row.category_id =
        category(
          'Marketing e publicidade'
        )?.id ||
        categoryByNature(
          'business_operating'
        )?.id ||
        null;

      row.description =
        'Facebook / Meta Ads';

      row.import_note =
        'Marketing e publicidade.';
    }

    else if (
      /joao paulo/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'business_operating';

      row.category_id =
        category(
          'Fretes e entregas'
        )?.id ||
        categoryByNature(
          'business_operating'
        )?.id ||
        null;

      row.description =
        'Frete / entrega — João Paulo';

      row.import_note =
        'Frete/entrega da operação.';
    }

    else if (
      /ifood|marmita|lanche|mercado|supermercado/
        .test(text) &&
      item.sign < 0
    ) {
      row.direction =
        'expense';

      row.nature =
        'personal_withdrawal';

      row.category_id =
        category(
          'Marmita',
          'Mercado pessoal',
          'Alimentação pessoal',
          'Outros pessoais'
        )?.id ||
        categoryByNature(
          'personal_withdrawal'
        )?.id ||
        null;

      row.import_note =
        'Despesa pessoal.';
    }

    else if (
      item.sign > 0
    ) {
      row.direction =
        'income';

      row.nature =
        'income';

      row.category_id =
        category(
          'Vendas da loja',
          'Receita de vendas'
        )?.id ||
        categoryByNature(
          'income'
        )?.id ||
        null;

      row.import_note =
        'Entrada classificada como venda/recebimento da loja.';
    }

    else {
      row.selected =
        false;

      row.status =
        'Revisar classificação';

      row.statusType =
        'review';

      row.category_id =
        categoryByNature(
          row.nature
        )?.id ||
        null;

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
        'Escolher categoria';

      row.statusType =
        'review';
    }

    return row;
  }

  function inferPaymentMethod(
    text
  ) {
    if (
      /boleto/
        .test(text)
    ) {
      return 'boleto';
    }

    if (
      /debito/
        .test(text)
    ) {
      return 'debit';
    }

    if (
      /credito/
        .test(text)
    ) {
      return 'credit';
    }

    if (
      /pix/
        .test(text)
    ) {
      return 'pix';
    }

    return 'other';
  }

  function findCategory(
    names
  ) {
    for (
      const name of names
    ) {
      const exact =
        state.categories.find(
          c =>
            Number(
              c.active
            ) !== 0 &&
            norm(
              c.name
            ) ===
              norm(
                name
              )
        );

      if (exact) {
        return exact;
      }
    }

    for (
      const name of names
    ) {
      const partial =
        state.categories.find(
          c =>
            Number(
              c.active
            ) !== 0 &&
            norm(
              c.name
            ).includes(
              norm(
                name
              )
            )
        );

      if (partial) {
        return partial;
      }
    }

    return null;
  }

  function categoryByNature(
    nature
  ) {
    return (
      state.categories.find(
        c =>
          Number(
            c.active
          ) !== 0 &&
          c.nature ===
            nature
      ) ||
      null
    );
  }

  function findDebt(
    names
  ) {
    for (
      const name of names
    ) {
      const found =
        state.debts.find(
          d =>
            d.status ===
              'active' &&
            norm(
              d.name
            ).includes(
              norm(
                name
              )
            )
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  function categoryOptions(
    row
  ) {
    if (
      row.direction ===
      'transfer'
    ) {
      return (
        '<option value="">' +
        'Não se aplica' +
        '</option>'
      );
    }

    const list =
      state.categories.filter(
        c =>
          Number(
            c.active
          ) !== 0 &&
          c.nature ===
            row.nature
      );

    return (
      '<option value="">' +
      'Selecione' +
      '</option>' +

      list.map(
        c => {
          const label =
            c.parent_name
              ? `${c.parent_name} › ${c.name}`
              : c.name;

          return (
            `<option value="${c.id}" ` +
            `${
              Number(c.id) ===
                Number(
                  row.category_id
                )
                ? 'selected'
                : ''
            }>` +
            `${esc(label)}` +
            '</option>'
          );
        }
      ).join('')
    );
  }

  function accountOptions(
    row
  ) {
    if (
      row.direction !==
      'transfer'
    ) {
      return (
        '<option value="">' +
        'Conta do extrato' +
        '</option>'
      );
    }

    const related =
      row.source_account_id ===
        state.selectedAccountId
        ? row.destination_account_id
        : row.source_account_id;

    return (
      '<option value="">' +
      'Externo / não cadastrado' +
      '</option>' +

      state.accounts
        .filter(
          a =>
            Number(
              a.id
            ) !==
            Number(
              state.selectedAccountId
            )
        )
        .map(
          a =>
            `<option value="${a.id}" ${
              Number(a.id) ===
                Number(
                  related
                )
                ? 'selected'
                : ''
            }>${esc(a.name)}</option>`
        )
        .join('')
    );
  }

  function render() {
    const host =
      $('pf196Rows');

    if (!host) {
      return;
    }

    if (
      !state.rows.length
    ) {
      host.innerHTML =
        '<tr>' +
        '<td colspan="10" style="padding:20px;text-align:center;color:#7d889a">' +
        'Nenhum movimento analisado.' +
        '</td>' +
        '</tr>';

      updateSummary();

      return;
    }

    host.innerHTML =
      state.rows
        .map(
          (
            row,
            index
          ) => `
            <tr>

              <td>
                <input
                  type="checkbox"
                  data-check="${index}"
                  ${
                    row.selected
                      ? 'checked'
                      : ''
                  }
                  ${
                    row.locked
                      ? 'disabled'
                      : ''
                  }
                >
              </td>

              <td>
                <input
                  type="date"
                  data-date="${index}"
                  value="${esc(row.date)}"
                >
              </td>

              <td>
                <input
                  type="time"
                  data-time="${index}"
                  value="${esc(row.time)}"
                >
              </td>

              <td>
                <input
                  class="desc"
                  type="text"
                  data-description="${index}"
                  value="${esc(row.description)}"
                >
              </td>

              <td>

                <select
                  data-direction="${index}"
                  ${
                    row.locked
                      ? 'disabled'
                      : ''
                  }
                >

                  <option
                    value="income"
                    ${
                      row.direction ===
                        'income'
                        ? 'selected'
                        : ''
                    }
                  >
                    Entrada
                  </option>

                  <option
                    value="expense"
                    ${
                      row.direction ===
                        'expense'
                        ? 'selected'
                        : ''
                    }
                  >
                    Saída
                  </option>

                  <option
                    value="transfer"
                    ${
                      row.direction ===
                        'transfer'
                        ? 'selected'
                        : ''
                    }
                  >
                    Transferência
                  </option>

                </select>

              </td>

              <td>
                ${
                  esc(
                    row.nature ===
                      'income'
                      ? 'Receita'
                      : row.nature ===
                          'business_operating'
                        ? 'Empresa · operação'
                        : row.nature ===
                            'business_debt'
                          ? 'Empresa · dívida'
                          : row.nature ===
                              'personal_withdrawal'
                            ? 'Pessoal'
                            : row.nature ===
                                'inventory'
                              ? 'Estoque'
                              : 'Transferência'
                  )
                }
              </td>

              <td>
                <select
                  data-category="${index}"
                  ${
                    row.direction ===
                      'transfer'
                      ? 'disabled'
                      : ''
                  }
                >
                  ${categoryOptions(row)}
                </select>
              </td>

              <td>
                <select
                  data-related="${index}"
                  ${
                    row.direction !==
                      'transfer'
                      ? 'disabled'
                      : ''
                  }
                >
                  ${accountOptions(row)}
                </select>
              </td>

              <td>
                <span
                  class="pf196-status ${row.statusType}"
                >
                  ${esc(row.status)}
                </span>

                <br>

                <small>
                  ${esc(row.import_note || '')}
                </small>
              </td>

              <td class="pf196-money">
                ${
                  row.direction ===
                    'income'
                    ? '+'
                    : row.direction ===
                        'expense'
                      ? '-'
                      : '↔'
                }${money(row.amount_cents)}
              </td>

            </tr>
          `
        )
        .join('');

    bindRowEvents();
    updateSummary();
  }

  function bindRowEvents() {
    document.querySelectorAll(
      '[data-check]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              state.rows[
                Number(
                  el.dataset.check
                )
              ].selected =
                el.checked;

              updateSummary();
            }
          )
      );

    document.querySelectorAll(
      '[data-date]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              state.rows[
                Number(
                  el.dataset.date
                )
              ].date =
                el.value;
            }
          )
      );

    document.querySelectorAll(
      '[data-time]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              state.rows[
                Number(
                  el.dataset.time
                )
              ].time =
                el.value;
            }
          )
      );

    document.querySelectorAll(
      '[data-description]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'input',
            () => {
              state.rows[
                Number(
                  el.dataset.description
                )
              ].description =
                el.value;
            }
          )
      );

    document.querySelectorAll(
      '[data-category]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              const row =
                state.rows[
                  Number(
                    el.dataset.category
                  )
                ];

              row.category_id =
                el.value
                  ? Number(
                      el.value
                    )
                  : null;

              if (
                row.category_id &&
                !row.locked
              ) {
                row.selected =
                  true;

                row.status =
                  'Pronto';

                row.statusType =
                  'ready';
              }

              render();
            }
          )
      );

    document.querySelectorAll(
      '[data-related]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              const row =
                state.rows[
                  Number(
                    el.dataset.related
                  )
                ];

              const related =
                el.value
                  ? Number(
                      el.value
                    )
                  : null;

              if (
                row.direction !==
                'transfer'
              ) {
                return;
              }

              if (
                row.source_account_id ===
                state.selectedAccountId
              ) {
                row.destination_account_id =
                  related;

              } else {
                row.source_account_id =
                  related;

                row.destination_account_id =
                  state.selectedAccountId;
              }
            }
          )
      );

    document.querySelectorAll(
      '[data-direction]'
    )
      .forEach(
        el =>
          el.addEventListener(
            'change',
            () => {
              const index =
                Number(
                  el.dataset.direction
                );

              const row =
                state.rows[
                  index
                ];

              const direction =
                el.value;

              row.direction =
                direction;

              row.debt_id =
                null;

              if (
                direction ===
                'income'
              ) {
                row.nature =
                  'income';

                row.source_account_id =
                  null;

                row.destination_account_id =
                  state.selectedAccountId;

                row.category_id =
                  categoryByNature(
                    'income'
                  )?.id ||
                  null;

              } else if (
                direction ===
                'expense'
              ) {
                row.nature =
                  'business_operating';

                row.source_account_id =
                  state.selectedAccountId;

                row.destination_account_id =
                  null;

                row.category_id =
                  categoryByNature(
                    'business_operating'
                  )?.id ||
                  null;

              } else {
                row.nature =
                  'transfer';

                row.category_id =
                  null;

                row.source_account_id =
                  state.selectedAccountId;

                row.destination_account_id =
                  null;
              }

              row.selected =
                true;

              row.status =
                direction ===
                  'transfer'
                  ? 'Revisar conta'
                  : 'Pronto';

              row.statusType =
                direction ===
                  'transfer'
                  ? 'review'
                  : 'ready';

              render();
            }
          )
      );
  }

  function updateSummary() {
    const selected =
      state.rows.filter(
        row =>
          row.selected &&
          !row.locked
      );

    const review =
      state.rows.filter(
        row =>
          row.statusType ===
          'review'
      ).length;

    let net =
      0;

    for (
      const row of selected
    ) {
      if (
        row.direction ===
        'income'
      ) {
        net +=
          Number(
            row.amount_cents ||
            0
          );
      }

      if (
        row.direction ===
        'expense'
      ) {
        net -=
          Number(
            row.amount_cents ||
            0
          );
      }

      if (
        row.direction ===
        'transfer'
      ) {
        if (
          Number(
            row.destination_account_id
          ) ===
          Number(
            state.selectedAccountId
          )
        ) {
          net +=
            Number(
              row.amount_cents ||
              0
            );
        }

        if (
          Number(
            row.source_account_id
          ) ===
          Number(
            state.selectedAccountId
          )
        ) {
          net -=
            Number(
              row.amount_cents ||
              0
            );
        }
      }
    }

    $('pf196Found')
      .textContent =
        String(
          state.rows.length
        );

    $('pf196Selected')
      .textContent =
        String(
          selected.length
        );

    $('pf196Review')
      .textContent =
        String(
          review
        );

    $('pf196Net')
      .textContent =
        money(net);

    $('pf196Commit')
      .disabled =
        selected.length ===
        0;
  }

  async function commit() {
    const rows =
      state.rows.filter(
        row =>
          row.selected &&
          !row.locked
      );

    if (
      !rows.length
    ) {
      return toast(
        'Nenhum lançamento selecionado.'
      );
    }

    if (
      !confirm(
        `Importar ${rows.length} lançamento(s)?\n\n` +
        'Duplicados serão ignorados automaticamente.'
      )
    ) {
      return;
    }

    const button =
      $('pf196Commit');

    button.disabled =
      true;

    button.textContent =
      'Importando...';

    try {
      const result =
        await api(
          '/api/v196/import-commit',
          {
            method:
              'POST',

            body:
              JSON.stringify(
                {
                  account_id:
                    state.selectedAccountId,

                  rows
                }
              )
          }
        );

      let message =
        `Importados: ${result.imported}\n` +
        `Duplicados ignorados: ${result.duplicates}\n` +
        `Saldo da conta: ${money(result.account?.balance_cents || 0)}`;

      if (
        result.errors?.length
      ) {
        message +=
          `\n\nNão importados: ${result.errors.length}`;
      }

      alert(
        message
      );

      location.reload();

    } catch (error) {
      toast(
        error.message
      );

      button.disabled =
        false;

      button.textContent =
        'Importar selecionados';
    }
  }

  applyVersion();

  setTimeout(
    applyVersion,
    300
  );

  setTimeout(
    applyVersion,
    1200
  );

  const footer =
    document.querySelector(
      '.sidebar-foot'
    );

  if (footer) {
    const observer =
      new MutationObserver(
        applyVersion
      );

    observer.observe(
      footer,
      {
        childList:true,
        subtree:true,
        characterData:true
      }
    );
  }

  let tries =
    0;

  const timer =
    setInterval(
      () => {
        tries +=
          1;

        applyVersion();

        if (
          install() ||
          tries >= 80
        ) {
          clearInterval(
            timer
          );
        }
      },
      250
    );
}
