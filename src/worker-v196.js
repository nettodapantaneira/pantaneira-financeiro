import worker194 from './worker-v194.js';

const VERSION = '1.9.6';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const response = await worker194.fetch(request, env, ctx);
      const type = response.headers.get('content-type') || '';

      if (url.pathname === '/api/health' && response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, response.status);
      }

      /*
       * O v194.js é a base estável da Conciliação.
       * Alteramos SOMENTE a constante de versão quando ele é servido,
       * evitando que o rodapé volte para v1.9.4.
       */
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

      /*
       * Mantém todo o HTML original da v1.9.4
       * e acrescenta somente a importação em lote.
       */
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

        const headers = freshHeaders(
          response.headers
        );

        return new Response(html, {
          status: response.status,
          headers
        });
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

function freshHeaders(source) {
  const headers =
    new Headers(source);

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

  .pf196-panel {
    display: none;
  }

  .pf196-panel.active {
    display: block;
  }

  .pf196-card {
    background: #fff;
    border: 1px solid #dfe4ed;
    border-radius: 18px;
    padding: 16px;
    box-shadow:
      0 5px 16px
      rgba(27,39,65,.035);
  }

  .pf196-grid {
    display: grid;
    grid-template-columns:
      260px minmax(0,1fr);
    gap: 12px;
  }

  .pf196-field {
    display: grid;
    gap: 5px;
    font-size: 10px;
    font-weight: 800;
    color: #556176;
  }

  .pf196-field select,
  .pf196-field textarea {
    width: 100%;
    padding: 10px 11px;
    border:
      1px solid #d9dfe8;
    border-radius: 11px;
    background: #fff;
    color: #172136;
  }

  .pf196-field textarea {
    min-height: 230px;
    resize: vertical;
    font-family: inherit;
    line-height: 1.45;
  }

  .pf196-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
  }

  .pf196-btn {
    border:
      1px solid #dbe1e9;
    border-radius: 10px;
    padding: 9px 13px;
    background: #fff;
    color: #33405a;
    font-weight: 800;
    cursor: pointer;
  }

  .pf196-btn.primary {
    border-color: #4057e8;
    background: #4057e8;
    color: #fff;
  }

  .pf196-btn:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  .pf196-note {
    margin-top: 10px;
    padding: 10px 12px;
    border:
      1px solid #dfe4ed;
    border-radius: 12px;
    background: #f8f9fc;
    color: #596579;
    font-size: 10px;
    line-height: 1.45;
  }

  .pf196-summary {
    display: grid;
    grid-template-columns:
      repeat(4,1fr);
    gap: 9px;
    margin: 13px 0;
  }

  .pf196-summary > div {
    padding: 11px 12px;
    border:
      1px solid #e4e8ef;
    border-radius: 13px;
    background: #fff;
  }

  .pf196-summary span {
    display: block;
    color: #8a94a5;
    font-size: 8px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: .08em;
  }

  .pf196-summary strong {
    display: block;
    margin-top: 3px;
    font-size: 15px;
    color: #172136;
  }

  .pf196-table-wrap {
    overflow: auto;
    background: #fff;
    border:
      1px solid #dfe4ed;
    border-radius: 18px;
  }

  .pf196-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 1180px;
  }

  .pf196-table th {
    background: #f7f9fc;
    color: #758197;
    font-size: 8px;
    text-align: left;
    padding: 9px;
    border-bottom:
      1px solid #e4e8ef;
  }

  .pf196-table td {
    padding: 8px;
    border-bottom:
      1px solid #edf0f4;
    font-size: 9px;
    vertical-align: middle;
  }

  .pf196-table input[type="text"],
  .pf196-table input[type="date"],
  .pf196-table input[type="time"],
  .pf196-table select {
    width: 100%;
    min-width: 105px;
    padding: 7px 8px;
    border:
      1px solid #dce1e9;
    border-radius: 8px;
    background: #fff;
    font-size: 9px;
  }

  .pf196-table .desc {
    min-width: 230px;
  }

  .pf196-money {
    font-weight: 850;
    white-space: nowrap;
  }

  .pf196-status {
    display: inline-flex;
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 8px;
    font-weight: 850;
    white-space: nowrap;
  }

  .pf196-status.ready {
    background: #eaf8ef;
    color: #147b42;
  }

  .pf196-status.review {
    background: #fff7df;
    color: #765900;
  }

  .pf196-status.blocked {
    background: #fff0ef;
    color: #b64038;
  }

  .pf196-status.duplicate {
    background: #eef1f6;
    color: #667085;
  }

  @media(max-width:760px) {

    .pf196-grid {
      grid-template-columns: 1fr;
    }

    .pf196-summary {
      grid-template-columns:
        1fr 1fr;
    }
  }

</style>

<script data-pf-v196-import>

(${client.toString()})();

</script>
`;
}

function client() {
  'use strict';

  const VERSION =
    '1.9.6';

  const MONTHS = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    março: 3,
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

  const state = {
    accounts: [],
    categories: [],
    debts: [],
    existing: [],
    rows: [],
    selectedAccountId: 0
  };

  const $ =
    id =>
      document.getElementById(
        id
      );

  const norm =
    value =>
      String(
        value || ''
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

  const esc =
    value =>
      String(
        value ?? ''
      )
        .replace(
          /[&<>"']/g,
          c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          })[c]
        );

  const money =
    cents =>
      new Intl.NumberFormat(
        'pt-BR',
        {
          style: 'currency',
          currency: 'BRL'
        }
      )
        .format(
          Number(
            cents || 0
          ) / 100
        );

  async function api(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        {
          headers: {
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

    if (!response.ok) {
      throw new Error(
        data.error ||
        \`Erro \${response.status}\`
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
        \`v\${VERSION}\`
    ) {
      footer.textContent =
        \`v\${VERSION}\`;
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
      \`\${y}-\` +
      \`\${String(m).padStart(2,'0')}-\` +
      \`\${String(d).padStart(2,'0')}\`
    );
  }

  function parseMoney(value) {
    let s =
      String(
        value || ''
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

  function cleanDescription(value) {
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
      'pf196-panel';

    panel.innerHTML = \`

      <article class="pf196-card">

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
              placeholder="Cole o extrato do Mercado Pago ou Nubank. Também aceita: 18/08 +87,00 venda Ana Clara"
            ></textarea>

          </label>

        </div>

        <div class="pf196-note">

          <b>Prévia antes de gravar.</b>

          Duplicados são bloqueados.
          Pagamentos de fatura,
          liberações e linhas de crédito
          ficam para revisão para não
          duplicar ou classificar errado.

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
          <span>Encontrados</span>
          <strong id="pf196Found">0</strong>
        </div>

        <div>
          <span>Selecionados</span>
          <strong id="pf196Selected">0</strong>
        </div>

        <div>
          <span>Revisar</span>
          <strong id="pf196Review">0</strong>
        </div>

        <div>
          <span>Líquido selecionado</span>
          <strong id="pf196Net">R$ 0,00</strong>
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
              <th>Natureza</th>
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
                Cole os movimentos
                e clique em Analisar.
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
    \`;

    page.appendChild(
      panel
    );

    tab.addEventListener(
      'click',
      () => {

        view
          .querySelectorAll(
            '.pf-conc-panel,.pf196-panel'
          )
          .forEach(
            p =>
              p.classList.remove(
                'active'
              )
          );

        view
          .querySelectorAll(
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

    view
      .querySelectorAll(
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
        debtsData,
        transactionsData
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
            ),

            api(
              '/api/transactions?limit=500&search_scope=content'
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

      state.existing =
        (
          transactionsData.transactions ||
          []
        )
          .filter(
            item =>
              item.status !==
              'void'
          );

      const select =
        $('pf196Account');

      select.innerHTML =
        '<option value="">Selecione</option>' +

        state.accounts
          .map(
            account =>
              \`<option value="\${account.id}">\${esc(account.name)} · \${money(account.balance_cents)}</option>\`
          )
          .join('');

      const mercadoPago =
        state.accounts.find(
          account =>
            norm(
              account.name
            ).includes(
              'mercado pago'
            )
        );

      if (mercadoPago) {
        select.value =
          String(
            mercadoPago.id
          );
      }

    } catch (error) {
      toast(
        error.message
      );
    }
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

    let description =
      '';

    let detail =
      '';

    for (
      const line of lines
    ) {
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

        description =
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

        description =
          '';

        detail =
          '';

        continue;
      }

      let match =
        line.match(
          /^(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)/i
        );

      if (
        match &&
        MONTHS[
          norm(
            match[2]
          )
        ]
      ) {
        currentDate =
          toIsoDate(
            Number(
              match[1]
            ),

            MONTHS[
              norm(
                match[2]
              )
            ],

            Number(
              localDate()
                .slice(
                  0,
                  4
                )
            )
          );

        description =
          '';

        detail =
          '';

        continue;
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
                localDate()
                  .slice(
                    0,
                    4
                  )
              );

        if (
          year < 100
        ) {
          year += 2000;
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

        description =
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
          \`\${String(
            Number(
              match[1]
            )
          ).padStart(
            2,
            '0'
          )}:\${match[2]}\`;

        continue;
      }

      const amount =
        parseSignedAmount(
          line
        );

      if (amount) {
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

            description:
              cleanDescription(
                description ||
                'Movimento importado'
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

      if (!description) {
        description =
          line;

      } else if (
        norm(
          description
        ) !==
          normalized
      ) {
        detail =
          \`\${detail} \${line}\`
            .trim();

        description =
          line;
      }
    }

    return rows.filter(
      row =>
        row.date &&
        row.amount_cents >
          0
    );
  }

  function parseSimpleLine(line) {
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
            localDate()
              .slice(
                0,
                4
              )
          );

    if (
      year < 100
    ) {
      year += 2000;
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

  function parseSignedAmount(line) {
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
        item =>
          Number(
            item.id
          ) ===
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
      parsed
        .map(
          item =>
            classify(
              item,
              account
            )
        )
        .map(
          markDuplicate
        );

    render();
  }

  function classify(
    item,
    account
  ) {
    const text =
      norm(
        \`\${item.description} \${item.detail || ''}\`
      );

    const row = {
      ...item,

      selected: true,
      locked: false,

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
        inferMethod(
          text
        ),

      import_note:
        ''
    };

    const cat =
      (...names) =>
        findCategory(
          names
        );

    const debt =
      (...names) =>
        findDebt(
          names
        );

    const other =
      name =>
        state.accounts.find(
          item =>
            Number(
              item.id
            ) !==
              Number(
                account.id
              ) &&
            norm(
              item.name
            ).includes(
              norm(name)
            )
        );

    /*
     * RENDIMENTOS / CDI
     */
    if (
      /rendimento|cdi/
        .test(text)
    ) {
      row.nature =
        'income';

      row.category_id =
        cat(
          'Rendimentos financeiros',
          'Outras receitas'
        )?.id ||
        null;

      row.description =
        'Rendimentos financeiros';

      row.payment_method =
        'other';

      row.import_note =
        'Rendimento/CDI.';
    }

    /*
     * PAGAMENTO DE FATURA
     */
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
        'Pagamento de fatura não é importado novamente aqui.';
    }

    /*
     * LINHA DE CRÉDITO
     */
    else if (
      /linha de credito|emprestimo pessoal|deposito do emprestimo/
        .test(text)
    ) {
      row.selected =
        false;

      row.locked =
        true;

      row.status =
        'Revisar empréstimo';

      row.statusType =
        'review';

      row.import_note =
        'Capital de giro/empréstimo precisa entrar como obrigação/dívida, não como receita.';
    }

    /*
     * LIBERAÇÃO DE DINHEIRO
     */
    else if (
      /liberacao de dinheiro/
        .test(text)
    ) {
      row.selected =
        false;

      row.locked =
        true;

      row.status =
        'Revisar liberação';

      row.statusType =
        'review';

      row.import_note =
        'Pode duplicar venda já lançada. Não é importada automaticamente.';
    }

    /*
     * TRANSFERÊNCIA MERCADO PAGO ↔ NUBANK
     */
    else if (
      /gerson lafayette|gerson bastos/
        .test(text)
    ) {
      const counterpart =
        norm(
          account.name
        ).includes(
          'mercado pago'
        )
          ? other(
              'Nubank'
            )
          : norm(
              account.name
            ).includes(
              'nubank'
            )
            ? other(
                'Mercado Pago'
              )
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
            \`\${account.name} → \${counterpart.name}\`;

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
            \`\${counterpart.name} → \${account.name}\`;
        }

        row.import_note =
          'Transferência entre contas próprias.';
      }

      else {
        row.selected =
          false;

        row.status =
          'Revisar transferência';

        row.statusType =
          'review';
      }
    }

    /*
     * DAVI ALEF = ACORDO SOCIETÁRIO
     */
    else if (
      /davi alef/
        .test(text) &&
      item.sign < 0
    ) {
      row.nature =
        'business_debt';

      row.category_id =
        cat(
          'Empréstimos e acordos',
          'Acordos e financiamentos'
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
        'Acordo societário.';
    }

    /*
     * ADEMICOM
     */
    else if (
      /ademicon/
        .test(text) &&
      item.sign < 0
    ) {
      row.nature =
        'business_debt';

      row.category_id =
        cat(
          'Consórcio',
          'Empréstimos e acordos',
          'Acordos e financiamentos'
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
    }

    /*
     * NATHAN = FUNCIONÁRIO
     */
    else if (
      /nathan/
        .test(text) &&
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
    }

    /*
     * FACEBOOK / META
     */
    else if (
      /facebook|instagram|meta\b/
        .test(text) &&
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
    }

    /*
     * JOÃO PAULO
     */
    else if (
      /joao paulo/
        .test(text) &&
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
    }

    /*
     * GASTOS PESSOAIS
     */
    else if (
      /ifood|marmita|lanche|mercado|supermercado/
        .test(text) &&
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
    }

    /*
     * PIX / RECEBIMENTO POSITIVO
     */
    else if (
      item.sign > 0
    ) {
      row.nature =
        'income';

      row.category_id =
        cat(
          'Vendas da loja',
          'Receita de vendas'
        )?.id ||
        null;

      row.import_note =
        'Venda/recebimento da loja.';
    }

    /*
     * SAÍDA DESCONHECIDA
     */
    else {
      row.selected =
        false;

      row.status =
        'Revisar classificação';

      row.statusType =
        'review';

      row.import_note =
        'Saída não reconhecida automaticamente.';
    }

    if (
      row.direction !==
        'transfer' &&
      !row.category_id &&
      !row.locked
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

  function markDuplicate(row) {
    const duplicate =
      state.existing.find(
        transaction => {

          const date =
            String(
              transaction.occurred_at ||
              ''
            ).slice(
              0,
              10
            );

          let sameAccount =
            false;

          if (
            row.direction ===
            'income'
          ) {
            sameAccount =
              Number(
                transaction
                  .destination_account_id ||
                0
              ) ===
              Number(
                row
                  .destination_account_id ||
                0
              );
          }

          else if (
            row.direction ===
            'expense'
          ) {
            sameAccount =
              Number(
                transaction
                  .source_account_id ||
                0
              ) ===
              Number(
                row
                  .source_account_id ||
                0
              );
          }

          else {
            sameAccount =
              Number(
                transaction
                  .source_account_id ||
                0
              ) ===
                Number(
                  row
                    .source_account_id ||
                  0
                ) &&

              Number(
                transaction
                  .destination_account_id ||
                0
              ) ===
                Number(
                  row
                    .destination_account_id ||
                  0
                );
          }

          return (
            date ===
              row.date &&

            transaction.direction ===
              row.direction &&

            Number(
              transaction.amount_cents ||
              0
            ) ===
              Number(
                row.amount_cents ||
                0
              ) &&

            sameAccount &&

            similar(
              transaction.description,
              row.description
            )
          );
        }
      );

    if (duplicate) {
      row.selected =
        false;

      row.locked =
        true;

      row.status =
        \`Duplicado #\${duplicate.id}\`;

      row.statusType =
        'duplicate';

      row.import_note =
        \`Já existe: \${duplicate.description}\`;
    }

    return row;
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

  function inferMethod(text) {
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

  function findCategory(names) {
    for (
      const name of names
    ) {
      const exact =
        state.categories.find(
          category =>
            Number(
              category.active
            ) !== 0 &&
            norm(
              category.name
            ) ===
              norm(name)
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
          category =>
            Number(
              category.active
            ) !== 0 &&
            norm(
              category.name
            ).includes(
              norm(name)
            )
        );

      if (partial) {
        return partial;
      }
    }

    return null;
  }

  function findDebt(names) {
    for (
      const name of names
    ) {
      const found =
        state.debts.find(
          debt =>
            debt.status ===
              'active' &&
            norm(
              debt.name
            ).includes(
              norm(name)
            )
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  function categoryOptions(row) {
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
        category =>
          Number(
            category.active
          ) !== 0 &&
          category.nature ===
            row.nature
      );

    return (
      '<option value="">' +
      'Selecione' +
      '</option>' +

      list
        .map(
          category =>
            \`<option value="\${category.id}" \${
              Number(
                category.id
              ) ===
                Number(
                  row.category_id
                )
                ? 'selected'
                : ''
            }>\${
              esc(
                category.parent_name
                  ? \`\${category.parent_name} › \${category.name}\`
                  : category.name
              )
            }</option>\`
        )
        .join('')
    );
  }

  function relatedAccountOptions(row) {
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
      Number(
        row.source_account_id
      ) ===
        Number(
          state.selectedAccountId
        )
        ? row.destination_account_id
        : row.source_account_id;

    return (
      '<option value="">' +
      'Selecione' +
      '</option>' +

      state.accounts
        .filter(
          account =>
            Number(
              account.id
            ) !==
              Number(
                state.selectedAccountId
              )
        )
        .map(
          account =>
            \`<option value="\${account.id}" \${
              Number(
                account.id
              ) ===
                Number(
                  related
                )
                ? 'selected'
                : ''
            }>\${esc(account.name)}</option>\`
        )
        .join('')
    );
  }

  function natureLabel(value) {
    return ({
      income:
        'Receita',

      business_operating:
        'Empresa · operação',

      business_debt:
        'Empresa · dívida',

      personal_withdrawal:
        'Pessoal',

      inventory:
        'Estoque',

      transfer:
        'Transferência'
    })[value] ||
    value;
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
          ) =>
            \`

            <tr>

              <td>

                <input
                  type="checkbox"
                  data-check="\${index}"
                  \${row.selected ? 'checked' : ''}
                  \${row.locked ? 'disabled' : ''}
                >

              </td>

              <td>

                <input
                  type="date"
                  data-date="\${index}"
                  value="\${esc(row.date)}"
                >

              </td>

              <td>

                <input
                  type="time"
                  data-time="\${index}"
                  value="\${esc(row.time)}"
                >

              </td>

              <td>

                <input
                  class="desc"
                  type="text"
                  data-description="\${index}"
                  value="\${esc(row.description)}"
                >

              </td>

              <td>

                <select
                  data-direction="\${index}"
                  \${row.locked ? 'disabled' : ''}
                >

                  <option
                    value="income"
                    \${row.direction === 'income' ? 'selected' : ''}
                  >
                    Entrada
                  </option>

                  <option
                    value="expense"
                    \${row.direction === 'expense' ? 'selected' : ''}
                  >
                    Saída
                  </option>

                  <option
                    value="transfer"
                    \${row.direction === 'transfer' ? 'selected' : ''}
                  >
                    Transferência
                  </option>

                </select>

              </td>

              <td>
                \${esc(
                  natureLabel(
                    row.nature
                  )
                )}
              </td>

              <td>

                <select
                  data-category="\${index}"
                  \${
                    row.direction ===
                      'transfer' ||
                    row.locked
                      ? 'disabled'
                      : ''
                  }
                >
                  \${categoryOptions(row)}
                </select>

              </td>

              <td>

                <select
                  data-related="\${index}"
                  \${
                    row.direction !==
                      'transfer' ||
                    row.locked
                      ? 'disabled'
                      : ''
                  }
                >
                  \${relatedAccountOptions(row)}
                </select>

              </td>

              <td>

                <span
                  class="pf196-status \${row.statusType}"
                >
                  \${esc(row.status)}
                </span>

                <br>

                <small>
                  \${esc(
                    row.import_note ||
                    ''
                  )}
                </small>

              </td>

              <td class="pf196-money">

                \${
                  row.direction ===
                    'income'
                    ? '+'
                    : row.direction ===
                        'expense'
                      ? '-'
                      : '↔'
                }\${money(row.amount_cents)}

              </td>

            </tr>
          \`
        )
        .join('');

    host
      .querySelectorAll(
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

    host
      .querySelectorAll(
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

    host
      .querySelectorAll(
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

    host
      .querySelectorAll(
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

    host
      .querySelectorAll(
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

              row.selected =
                !!row.category_id;

              row.status =
                row.selected
                  ? 'Pronto'
                  : 'Escolher categoria';

              row.statusType =
                row.selected
                  ? 'ready'
                  : 'review';

              render();
            }
          )
      );

    host
      .querySelectorAll(
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
                Number(
                  row.source_account_id
                ) ===
                  Number(
                    state.selectedAccountId
                  )
              ) {
                row.destination_account_id =
                  related;

              } else {
                row.source_account_id =
                  related;
              }

              row.selected =
                !!related;

              row.status =
                row.selected
                  ? 'Pronto'
                  : 'Revisar conta';

              row.statusType =
                row.selected
                  ? 'ready'
                  : 'review';

              render();
            }
          )
      );

    updateSummary();
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

    let net = 0;

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

      else if (
        row.direction ===
        'expense'
      ) {
        net -=
          Number(
            row.amount_cents ||
            0
          );
      }

      else if (
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

    if (!rows.length) {
      return toast(
        'Nenhum lançamento selecionado.'
      );
    }

    if (
      !confirm(
        \`Importar \${rows.length} lançamento(s)?

Revise os itens amarelos antes de continuar.\`
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

    let imported =
      0;

    let failed =
      0;

    for (
      const row of rows
    ) {
      try {
        const payload = {
          occurred_at:
            \`\${row.date}T\${row.time || '12:00'}:00-04:00\`,

          direction:
            row.direction,

          amount_cents:
            Number(
              row.amount_cents
            ),

          description:
            String(
              row.description ||
              ''
            ).trim(),

          nature:
            row.nature,

          category_id:
            row.direction ===
              'transfer'
              ? null
              : (
                  row.category_id ||
                  null
                ),

          obligation_id:
            null,

          debt_id:
            row.debt_id ||
            null,

          source_account_id:
            row.direction ===
              'income'
              ? null
              : (
                  row.source_account_id ||
                  state.selectedAccountId
                ),

          destination_account_id:
            row.direction ===
              'expense'
              ? null
              : (
                  row.destination_account_id ||
                  state.selectedAccountId
                ),

          payment_method:
            row.direction ===
              'transfer'
              ? 'transfer'
              : (
                  row.payment_method ||
                  'other'
                ),

          notes:
            \`Importado em lote pela Conciliação v\${VERSION}. \${row.import_note || ''}\`
              .trim()
        };

        await api(
          '/api/transactions',
          {
            method:
              'POST',

            body:
              JSON.stringify(
                payload
              )
          }
        );

        imported++;

      } catch (error) {
        console.error(
          'Falha ao importar',
          row,
          error
        );

        failed++;
      }
    }

    alert(
      \`Importação concluída.

Importados: \${imported}
Falhas: \${failed}\`
    );

    location.reload();
  }

  applyVersion();

  let tries =
    0;

  const timer =
    setInterval(
      () => {
        tries++;

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
