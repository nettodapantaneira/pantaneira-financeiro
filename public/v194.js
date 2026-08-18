(() => {
  'use strict';

  const VERSION = '1.9.4';
  const LIMIT = 500;

  const $ = id => document.getElementById(id);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = c => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c || 0) / 100);
  const centsInput = c => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
  const numOrNull = v => v ? Number(v) : null;

  let accounts = [];
  let categories = [];
  let current = null;

  async function api(path, options = {}) {
    const r = await fetch(path, {
      headers: {'Content-Type':'application/json', ...(options.headers || {})},
      ...options
    });

    let data = {};
    try { data = await r.json(); } catch {}

    if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
    return data;
  }

  function parseMoney(v) {
    let s = String(v ?? '').trim().replace(/\s/g, '');
    if (!s) throw new Error('Informe o valor.');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

    const n = Number(s);

    if (!Number.isFinite(n) || n < 0) {
      throw new Error('Valor inválido.');
    }

    return Math.round(n * 100);
  }

  function toast(text) {
    const el = $('toast');

    if (!el) {
      alert(text);
      return;
    }

    el.textContent = text;
    el.hidden = false;

    clearTimeout(window.__pf194Toast);

    window.__pf194Toast = setTimeout(() => {
      el.hidden = true;
    }, 4200);
  }

  function applyVersion() {
    const footer = document.querySelector('.sidebar-foot strong');

    if (footer && footer.textContent !== `v${VERSION}`) {
      footer.textContent = `v${VERSION}`;
    }

    document.documentElement.dataset.appVersion = VERSION;
    window.PANTANEIRA_FINANCEIRO_VERSION = VERSION;
  }

  function injectCss() {
    if ($('pf194SearchCss')) return;

    const style = document.createElement('style');
    style.id = 'pf194SearchCss';

    style.textContent = `
      .pf194-search{
        margin:12px 0 14px;padding:12px;background:#fff;border:1px solid #dfe4ed;
        border-radius:15px;box-shadow:0 4px 14px rgba(27,39,65,.03)
      }

      .pf194-search-head{
        display:flex;justify-content:space-between;gap:10px;margin-bottom:8px
      }

      .pf194-search-head strong{
        font-size:13px;color:#172136
      }

      .pf194-search-head small{
        font-size:9px;color:#7f8a9c
      }

      .pf194-search-row{
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px
      }

      .pf194-search-row input{
        min-width:0;padding:10px 11px;border:1px solid #d9dfe8;border-radius:11px
      }

      .pf194-search-row button{
        border:0;border-radius:10px;padding:9px 14px;background:#4057e8;
        color:#fff;font-weight:800;cursor:pointer
      }

      .pf194-dialog{
        width:min(94vw,850px);max-height:90vh;padding:0;border:0;border-radius:18px;
        box-shadow:0 24px 70px rgba(17,24,39,.26)
      }

      .pf194-dialog::backdrop{
        background:rgba(17,24,39,.42)
      }

      .pf194-dialog-head{
        display:flex;align-items:center;justify-content:space-between;padding:15px 16px;
        border-bottom:1px solid #e7ebf1
      }

      .pf194-dialog-head strong{
        font-size:15px;color:#172136
      }

      .pf194-dialog-head button{
        width:32px;height:32px;border:0;border-radius:10px;background:#f0f3f7;cursor:pointer
      }

      .pf194-summary{
        display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 16px 0
      }

      .pf194-summary>div{
        padding:9px 10px;border:1px solid #e6eaf0;border-radius:11px;background:#f8f9fc
      }

      .pf194-summary span{
        display:block;font-size:8px;color:#8993a4
      }

      .pf194-summary b{
        display:block;margin-top:2px;font-size:12px;color:#172136
      }

      .pf194-results{
        display:grid;gap:8px;max-height:62vh;overflow:auto;padding:12px 16px 16px
      }

      .pf194-result{
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;
        padding:11px 12px;border:1px solid #e1e6ee;border-radius:13px;background:#fff
      }

      .pf194-result strong{
        display:block;font-size:12px;color:#172136
      }

      .pf194-result small{
        display:block;margin-top:3px;font-size:8px;color:#8590a2;line-height:1.35
      }

      .pf194-side{
        text-align:right
      }

      .pf194-value{
        font-weight:800;font-size:12px
      }

      .pf194-value.income{
        color:#138447
      }

      .pf194-value.expense{
        color:#c74640
      }

      .pf194-side button{
        margin-top:6px;padding:7px 9px;border:0;border-radius:8px;background:#eef1ff;
        color:#4057e8;font-size:9px;font-weight:800;cursor:pointer
      }

      .pf194-form{
        display:grid;gap:10px;max-height:78vh;overflow:auto;padding:16px
      }

      .pf194-form label{
        display:grid;gap:4px;font-size:10px;font-weight:800;color:#4f5b70
      }

      .pf194-form input,
      .pf194-form select,
      .pf194-form textarea{
        width:100%;padding:10px 11px;border:1px solid #d9dfe8;border-radius:11px;
        background:#fff;color:#172136
      }

      .pf194-grid{
        display:grid;grid-template-columns:1fr 1fr;gap:9px
      }

      .pf194-warning{
        padding:10px 12px;border:1px solid #ead79d;border-radius:12px;
        background:#fff7df;color:#634d0e;font-size:10px;line-height:1.45
      }

      .pf194-warning[hidden]{
        display:none
      }

      .pf194-actions{
        display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap
      }

      .pf194-danger,
      .pf194-primary{
        padding:10px 13px;border-radius:10px;font-weight:800;cursor:pointer
      }

      .pf194-danger{
        border:1px solid #e2a7a3;background:#fff;color:#b64038
      }

      .pf194-primary{
        border:0;background:#4057e8;color:#fff
      }

      @media(max-width:640px){
        .pf194-search-head{display:block}
        .pf194-search-head small{display:block;margin-top:3px}
        .pf194-summary{grid-template-columns:1fr 1fr}
        .pf194-result{grid-template-columns:1fr}
        .pf194-side{text-align:left}
        .pf194-grid{grid-template-columns:1fr}
      }
    `;

    document.head.appendChild(style);
  }

  function makeSearchCard(id, placeholder) {
    const card = document.createElement('div');

    card.id = id;
    card.className = 'pf194-search';

    card.innerHTML = `
      <div class="pf194-search-head">
        <strong>Pesquisar lançamentos</strong>
        <small>#ID, descrição, valor, conta ou categoria</small>
      </div>

      <div class="pf194-search-row">
        <input autocomplete="off" placeholder="${esc(placeholder)}">
        <button type="button">Pesquisar</button>
      </div>
    `;

    return card;
  }

  function installSearchBars() {
    if (!$('pf194MovementSearch')) {
      const heading = document.querySelector('#view-lancar .page-heading');

      if (heading) {
        const card = makeSearchCard(
          'pf194MovementSearch',
          'Ex.: #88, Mercado Pago, marmita, 315,89'
        );

        heading.insertAdjacentElement('afterend', card);

        const input = card.querySelector('input');
        const run = () => search(input.value, '');

        card.querySelector('button').addEventListener('click', run);

        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run();
          }
        });
      }
    }

    if (!$('pf194AnalysisSearch')) {
      const heading = document.querySelector('#view-relatorios .analysis-heading');

      if (heading) {
        const card = makeSearchCard(
          'pf194AnalysisSearch',
          'Pesquisar no mês selecionado'
        );

        heading.insertAdjacentElement('afterend', card);

        const input = card.querySelector('input');

        const run = () => {
          search(
            input.value,
            $('analysisPeriod')?.value || ''
          );
        };

        card.querySelector('button').addEventListener('click', run);

        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run();
          }
        });
      }
    }

    interceptOldSearchId();
  }

  function interceptOldSearchId() {
    const btn = $('bulkSearchBtn');
    const input = $('bulkSearch');

    if (!btn || !input || btn.dataset.pf194) {
      return;
    }

    btn.dataset.pf194 = '1';

    const intercept = e => {
      const term = input.value.trim();

      if (!/^#\d+$/.test(term)) {
        return false;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      search(term, '');

      return true;
    };

    btn.addEventListener(
      'click',
      intercept,
      true
    );

    input.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Enter') {
          intercept(e);
        }
      },
      true
    );
  }

  async function search(raw, periodKey) {
    const term = String(raw || '').trim();

    if (!term) {
      toast('Digite o que deseja procurar.');
      return;
    }

    try {
      const idMatch = term.match(/^#(\d+)$/);

      const params = new URLSearchParams({
        limit:String(LIMIT),
        search_scope:'content'
      });

      if (periodKey) {
        params.set(
          'period_key',
          periodKey
        );
      }

      if (!idMatch) {
        params.set(
          'q',
          term
        );
      }

      let data = await api(
        `/api/transactions?${params.toString()}`
      );

      let rows = (data.transactions || [])
        .filter(
          t => t.status !== 'void'
        );

      if (idMatch) {
        const id =
          Number(idMatch[1]);

        rows = rows.filter(
          t => Number(t.id) === id
        );

        if (
          !rows.length &&
          periodKey
        ) {
          data = await api(
            `/api/transactions?limit=${LIMIT}&search_scope=content`
          );

          rows = (data.transactions || [])
            .filter(
              t =>
                t.status !== 'void' &&
                Number(t.id) === id
            );
        }
      }

      renderResults(
        term,
        rows
      );

    } catch (err) {
      toast(err.message);
    }
  }

  function buildDialogs() {
    if (!$('pf194ResultsDialog')) {
      const d =
        document.createElement(
          'dialog'
        );

      d.id =
        'pf194ResultsDialog';

      d.className =
        'pf194-dialog';

      d.innerHTML = `
        <div class="pf194-dialog-head">
          <strong id="pf194ResultsTitle">
            Resultados
          </strong>

          <button type="button">
            ×
          </button>
        </div>

        <div
          id="pf194ResultsSummary"
          class="pf194-summary"
        ></div>

        <div
          id="pf194ResultsList"
          class="pf194-results"
        ></div>
      `;

      d.querySelector('button')
        .addEventListener(
          'click',
          () => d.close()
        );

      document.body
        .appendChild(d);
    }

    if (!$('pf194EditorDialog')) {
      const d =
        document.createElement(
          'dialog'
        );

      d.id =
        'pf194EditorDialog';

      d.className =
        'pf194-dialog';

      d.innerHTML = `
        <div class="pf194-dialog-head">
          <strong id="pf194EditorTitle">
            Editar lançamento
          </strong>

          <button
            type="button"
            data-close
          >
            ×
          </button>
        </div>

        <form
          id="pf194EditorForm"
          class="pf194-form"
        >
          <div
            id="pf194Warning"
            class="pf194-warning"
            hidden
          ></div>

          <div class="pf194-grid">
            <label>
              Data
              <input
                id="pf194Date"
                type="date"
                required
              >
            </label>

            <label>
              Valor
              <input
                id="pf194Amount"
                inputmode="decimal"
                required
              >
            </label>
          </div>

          <label>
            Descrição
            <input
              id="pf194Description"
              required
            >
          </label>

          <div class="pf194-grid">
            <label>
              Forma

              <select id="pf194Method">
                <option value="pix">
                  Pix
                </option>

                <option value="cash">
                  Dinheiro
                </option>

                <option value="debit">
                  Débito
                </option>

                <option value="credit">
                  Crédito
                </option>

                <option value="transfer">
                  Transferência
                </option>

                <option value="boleto">
                  Boleto
                </option>

                <option value="other">
                  Outra
                </option>
              </select>
            </label>

            <label>
              Categoria
              <select id="pf194Category"></select>
            </label>
          </div>

          <div id="pf194SourceWrap">
            <label>
              De onde saiu?
              <select id="pf194Source"></select>
            </label>
          </div>

          <div id="pf194DestinationWrap">
            <label>
              Onde entrou?
              <select id="pf194Destination"></select>
            </label>
          </div>

          <label>
            Observação
            <textarea
              id="pf194Notes"
              rows="3"
            ></textarea>
          </label>

          <div class="pf194-actions">
            <button
              type="button"
              id="pf194Void"
              class="pf194-danger"
            >
              Cancelar lançamento
            </button>

            <button
              type="submit"
              class="pf194-primary"
            >
              Salvar correção
            </button>
          </div>
        </form>
      `;

      d.querySelector(
        '[data-close]'
      )
        .addEventListener(
          'click',
          () => d.close()
        );

      $('pf194EditorForm')
        .addEventListener(
          'submit',
          saveEdit
        );

      $('pf194Void')
        .addEventListener(
          'click',
          voidEdit
        );

      $('pf194Method')
        .addEventListener(
          'change',
          refreshWarning
        );

      $('pf194Source')
        .addEventListener(
          'change',
          refreshWarning
        );

      document.body
        .appendChild(d);
    }
  }

  function renderResults(
    term,
    rows
  ) {
    buildDialogs();

    const income =
      rows
        .filter(
          t =>
            t.direction ===
            'income'
        )
        .reduce(
          (a,t) =>
            a +
            Number(
              t.amount_cents || 0
            ),
          0
        );

    const expense =
      rows
        .filter(
          t =>
            t.direction ===
            'expense'
        )
        .reduce(
          (a,t) =>
            a +
            Number(
              t.amount_cents || 0
            ),
          0
        );

    $('pf194ResultsTitle')
      .textContent =
        `Resultados para “${term}”`;

    $('pf194ResultsSummary')
      .innerHTML = `
        <div>
          <span>
            Resultados
          </span>

          <b>
            ${rows.length}
          </b>
        </div>

        <div>
          <span>
            Entradas
          </span>

          <b>
            ${money(income)}
          </b>
        </div>

        <div>
          <span>
            Saídas
          </span>

          <b>
            ${money(expense)}
          </b>
        </div>
      `;

    $('pf194ResultsList')
      .innerHTML =
        rows.map(t => {
          const account =
            t.direction === 'income'
              ? (
                  t.destination_account ||
                  'Destino não informado'
                )
              : t.direction === 'transfer'
                ? `${t.source_account || 'Origem?'} → ${t.destination_account || 'Destino?'}`
                : (
                    t.source_account ||
                    'Origem não informada'
                  );

          const sign =
            t.direction === 'income'
              ? '+'
              : t.direction === 'expense'
                ? '-'
                : '';

          const cls =
            t.direction === 'income'
              ? 'income'
              : t.direction === 'expense'
                ? 'expense'
                : '';

          return `
            <article class="pf194-result">
              <div>
                <strong>
                  ${esc(t.description)}
                </strong>

                <small>
                  #${t.id}
                  · ${esc(
                    String(
                      t.occurred_at || ''
                    ).slice(0,10)
                  )}
                  · ${esc(account)}
                  ${
                    t.category_name
                      ? ` · ${esc(t.category_name)}`
                      : ''
                  }
                </small>
              </div>

              <div class="pf194-side">
                <div class="pf194-value ${cls}">
                  ${sign}${money(t.amount_cents)}
                </div>

                <button
                  type="button"
                  data-edit="${t.id}"
                >
                  Editar #${t.id}
                </button>
              </div>
            </article>
          `;
        }).join('') ||
        `
          <div class="pf194-warning">
            Nenhum lançamento encontrado.
          </div>
        `;

    $('pf194ResultsList')
      .querySelectorAll(
        '[data-edit]'
      )
      .forEach(btn => {
        btn.addEventListener(
          'click',
          () => {
            const id =
              Number(
                btn.dataset.edit
              );

            const t =
              rows.find(
                x =>
                  Number(x.id) === id
              );

            if (t) {
              openEditor(t);
            }
          }
        );
      });

    $('pf194ResultsDialog')
      .showModal();
  }

  async function loadCatalogs() {
    if (
      accounts.length &&
      categories.length
    ) {
      return;
    }

    const [a,c] =
      await Promise.all([
        api('/api/accounts'),
        api('/api/categories?all=1')
      ]);

    accounts =
      a.accounts || [];

    categories =
      c.categories || [];
  }

  async function openEditor(t) {
    await loadCatalogs();
    buildDialogs();

    current =
      {...t};

    $('pf194EditorTitle')
      .textContent =
        `Editar lançamento #${t.id}`;

    $('pf194Date').value =
      String(
        t.occurred_at || ''
      ).slice(0,10);

    $('pf194Amount').value =
      centsInput(
        t.amount_cents
      );

    $('pf194Description').value =
      t.description || '';

    $('pf194Method').value =
      t.payment_method ||
      'other';

    $('pf194Notes').value =
      t.notes || '';

    const catOptions =
      categories
        .filter(
          c =>
            c.nature ===
              t.nature &&
            (
              Number(c.active) !== 0 ||
              Number(c.id) ===
                Number(
                  t.category_id
                )
            )
        )
        .map(
          c =>
            `
              <option value="${c.id}">
                ${esc(
                  c.parent_name
                    ? `${c.parent_name} › ${c.name}`
                    : c.name
                )}
              </option>
            `
        )
        .join('');

    $('pf194Category')
      .innerHTML =
        `
          <option value="">
            Sem categoria
          </option>
          ${catOptions}
        `;

    if (t.category_id) {
      $('pf194Category').value =
        String(
          t.category_id
        );
    }

    const accOptions =
      accounts
        .map(
          a =>
            `
              <option value="${a.id}">
                ${esc(a.name)}
                · ${money(a.balance_cents)}
              </option>
            `
        )
        .join('');

    $('pf194Source')
      .innerHTML =
        accOptions;

    $('pf194Destination')
      .innerHTML =
        accOptions;

    if (
      t.source_account_id
    ) {
      $('pf194Source').value =
        String(
          t.source_account_id
        );
    }

    if (
      t.destination_account_id
    ) {
      $('pf194Destination').value =
        String(
          t.destination_account_id
        );
    }

    $('pf194SourceWrap').hidden =
      t.direction ===
      'income';

    $('pf194DestinationWrap').hidden =
      t.direction ===
      'expense';

    refreshWarning();

    $('pf194ResultsDialog')
      .close();

    $('pf194EditorDialog')
      .showModal();
  }

  function accountName(
    selectId
  ) {
    const text =
      $(selectId)
        ?.selectedOptions?.[0]
        ?.textContent || '';

    return String(text)
      .replace(
        /\s+·\s+R\$.+$/,
        ''
      )
      .trim();
  }

  function refreshWarning() {
    if (!current) return;

    const bad =
      current.direction ===
        'expense' &&
      $('pf194Method').value ===
        'credit' &&
      norm(
        accountName(
          'pf194Source'
        )
      )
        .includes(
          'mercado pago'
        );

    $('pf194Warning').hidden =
      !bad;

    $('pf194Warning')
      .innerHTML =
        bad
          ? `
            <strong>
              Inconsistência:
            </strong>
            esta compra está no crédito e reduzindo a conta Mercado Pago.
            Compra no cartão deve ficar na fatura.
            Para corrigir este lançamento antigo,
            use <b>Cancelar lançamento</b>
            e depois registre a compra na fatura correta.
          `
          : '';
  }

  async function saveEdit(e) {
    e.preventDefault();

    if (!current) return;

    try {
      const bad =
        current.direction ===
          'expense' &&
        $('pf194Method').value ===
          'credit' &&
        norm(
          accountName(
            'pf194Source'
          )
        )
          .includes(
            'mercado pago'
          );

      if (bad) {
        throw new Error(
          'Bloqueado: compra no cartão Mercado Pago não pode reduzir a conta bancária Mercado Pago.'
        );
      }

      const date =
        $('pf194Date').value;

      if (!date) {
        throw new Error(
          'Informe a data.'
        );
      }

      const payload = {
        occurred_at:
          `${date}T16:00:00.000Z`,

        direction:
          current.direction,

        amount_cents:
          parseMoney(
            $('pf194Amount').value
          ),

        description:
          $('pf194Description')
            .value
            .trim(),

        nature:
          current.nature,

        category_id:
          numOrNull(
            $('pf194Category').value
          ),

        obligation_id:
          current.obligation_id
            ? Number(
                current.obligation_id
              )
            : null,

        debt_id:
          current.debt_id
            ? Number(
                current.debt_id
              )
            : null,

        source_account_id:
          current.direction ===
            'income'
            ? null
            : numOrNull(
                $('pf194Source').value
              ),

        destination_account_id:
          current.direction ===
            'expense'
            ? null
            : numOrNull(
                $('pf194Destination').value
              ),

        payment_method:
          $('pf194Method').value,

        notes:
          $('pf194Notes')
            .value
            .trim() ||
          null
      };

      await api(
        `/api/transactions/${current.id}`,
        {
          method:'PATCH',
          body:
            JSON.stringify(
              payload
            )
        }
      );

      $('pf194EditorDialog')
        .close();

      toast(
        'Lançamento corrigido. Saldos e relatórios foram recalculados.'
      );

      $('refreshBtn')
        ?.click();

    } catch (err) {
      toast(
        err.message
      );
    }
  }

  async function voidEdit() {
    if (!current) return;

    if (
      !confirm(
        `Cancelar o lançamento #${current.id}?\n\n` +
        `${current.description} · ${money(current.amount_cents)}\n\n` +
        `Ele deixará de afetar saldos e relatórios, mas continuará na auditoria como CANCELADO.`
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/transactions/${current.id}`,
        {
          method:'DELETE'
        }
      );

      $('pf194EditorDialog')
        .close();

      toast(
        'Lançamento cancelado. Saldos e relatórios foram recalculados.'
      );

      $('refreshBtn')
        ?.click();

    } catch (err) {
      toast(
        err.message
      );
    }
  }

  function start() {
    applyVersion();
    injectCss();
    buildDialogs();
    installSearchBars();

    setTimeout(
      installSearchBars,
      300
    );

    setTimeout(
      installSearchBars,
      1000
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
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once:true
      }
    );
  } else {
    start();
  }
})();
