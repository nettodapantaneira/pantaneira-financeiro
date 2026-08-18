(() => {
  'use strict';

  const VERSION = '1.9.5';
  let catalogs = null;
  let activeTransaction = null;
  let decorateTimer = null;

  const q = (selector, root = document) =>
    root.querySelector(selector);

  const qa = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const money = cents =>
    new Intl.NumberFormat(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    ).format(Number(cents || 0) / 100);

  const esc = value =>
    String(value ?? '')
      .replace(
        /[&<>"']/g,
        char => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[char]
      );

  function applyVersion() {
    const footer = q('.sidebar-foot strong');

    if (
      footer &&
      footer.textContent !== `v${VERSION}`
    ) {
      footer.textContent = `v${VERSION}`;
    }

    const versionMetric = qa('#view-relatorios .metric')
      .find(card =>
        q('span', card)?.textContent?.trim() === 'Versão'
      );

    if (versionMetric) {
      const strong = q('strong', versionMetric);
      if (strong) strong.textContent = VERSION;
    }

    document.documentElement.dataset.appVersion =
      VERSION;

    window.PANTANEIRA_FINANCEIRO_VERSION =
      VERSION;
  }

  async function api(path, options = {}) {
    const response = await fetch(
      path,
      {
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        },
        ...options
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Erro ${response.status}`
      );
    }

    return data;
  }

  function notify(message) {
    const toast = q('#toast');

    if (toast) {
      toast.textContent = message;
      toast.hidden = false;

      setTimeout(() => {
        toast.hidden = true;
      }, 3200);

      return;
    }

    alert(message);
  }

  function injectStyles() {
    if (q('#v195Styles')) return;

    const style = document.createElement('style');
    style.id = 'v195Styles';

    style.textContent = `
      .v195-search-box{
        display:flex;
        gap:8px;
        align-items:center;
        margin:12px 0 16px;
        padding:10px;
        background:#fff;
        border:1px solid #dfe4ed;
        border-radius:15px;
        box-shadow:0 4px 14px rgba(27,39,65,.03)
      }
      .v195-search-box input{
        flex:1;
        min-width:0;
        border:1px solid #d9dfe8;
        border-radius:11px;
        padding:11px 12px;
        background:#fff;
        color:#172136
      }
      .v195-search-box button,
      .v195-inline-edit,
      .v195-card-action{
        border:0;
        border-radius:10px;
        padding:9px 12px;
        font-weight:800;
        cursor:pointer
      }
      .v195-search-box button{
        background:#4057e8;
        color:#fff
      }
      .v195-inline-edit{
        margin-top:7px;
        background:#eef1ff;
        color:#4057e8;
        font-size:10px
      }
      .v195-card-warning{
        margin:8px 0 12px;
        padding:12px;
        border-radius:13px;
        background:#fff7df;
        border:1px solid #ead79d;
        color:#624b09;
        font-size:11px;
        line-height:1.45
      }
      .v195-card-warning strong{
        display:block;
        margin-bottom:4px;
        color:#493600
      }
      .v195-card-actions{
        display:flex;
        gap:7px;
        flex-wrap:wrap;
        margin-top:9px
      }
      .v195-card-action{
        background:#172136;
        color:#fff;
        font-size:10px
      }
      .v195-card-action.personal{
        background:#4057e8
      }
      .v195-dialog{
        width:min(94vw,680px);
        max-height:90vh;
        padding:0;
        border:0;
        border-radius:18px;
        box-shadow:0 22px 70px rgba(17,24,39,.24)
      }
      .v195-dialog::backdrop{
        background:rgba(17,24,39,.42)
      }
      .v195-dialog-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:16px;
        border-bottom:1px solid #e7ebf1
      }
      .v195-dialog-head strong{
        color:#172136;
        font-size:16px
      }
      .v195-dialog-head button{
        width:32px;
        height:32px;
        border:0;
        border-radius:10px;
        background:#f0f3f7;
        cursor:pointer
      }
      .v195-form{
        display:grid;
        gap:10px;
        padding:16px;
        max-height:calc(90vh - 65px);
        overflow:auto
      }
      .v195-form label{
        display:grid;
        gap:4px;
        color:#4f5b70;
        font-size:10px;
        font-weight:800
      }
      .v195-form input,
      .v195-form select,
      .v195-form textarea{
        width:100%;
        border:1px solid #d9dfe8;
        border-radius:11px;
        padding:10px 11px;
        background:#fff;
        color:#172136
      }
      .v195-grid-2{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:9px
      }
      .v195-dialog-actions{
        display:flex;
        justify-content:space-between;
        gap:8px;
        flex-wrap:wrap;
        margin-top:5px
      }
      .v195-danger{
        border:1px solid #e2a7a3;
        background:#fff;
        color:#b64038;
        border-radius:10px;
        padding:10px 12px;
        font-weight:800;
        cursor:pointer
      }
      .v195-primary{
        border:0;
        background:#4057e8;
        color:#fff;
        border-radius:10px;
        padding:10px 14px;
        font-weight:800;
        cursor:pointer
      }
      .v195-helper{
        margin-top:5px;
        color:#7e899b;
        font-size:9px
      }
      @media(max-width:640px){
        .v195-search-box{
          display:grid;
          grid-template-columns:1fr;
        }
        .v195-grid-2{
          grid-template-columns:1fr
        }
      }
    `;

    document.head.appendChild(style);
  }

  function addMovementSearch() {
    if (q('#v195MovementSearch')) return;

    const heading = q('#view-lancar .page-heading');
    if (!heading) return;

    const box = document.createElement('div');
    box.id = 'v195MovementSearch';
    box.className = 'v195-search-box';

    box.innerHTML = `
      <input
        id="v195MovementSearchInput"
        placeholder="Pesquisar por #ID, descrição, valor, conta ou categoria"
        autocomplete="off"
      >
      <button type="button" id="v195MovementSearchBtn">
        Pesquisar
      </button>
    `;

    heading.insertAdjacentElement('afterend', box);

    const input = q('#v195MovementSearchInput');
    const button = q('#v195MovementSearchBtn');

    const run = () => {
      const value = input.value.trim();

      if (!value) {
        input.focus();
        return;
      }

      const id = exactId(value);

      if (id) {
        openProfessionalEditor(id);
        return;
      }

      q('#bulkEditBtn')?.click();

      setTimeout(() => {
        const bulk = q('#bulkSearch');

        if (!bulk) return;

        bulk.value = value;
        q('#bulkSearchBtn')?.click();
      }, 80);
    };

    button.addEventListener('click', run);

    input.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          run();
        }
      }
    );
  }

  function enhanceBulkSearch() {
    const input = q('#bulkSearch');

    if (input) {
      input.placeholder =
        '#96, descrição, categoria, fornecedor, valor ou observação';

      if (!input.dataset.v195IdSearch) {
        input.dataset.v195IdSearch = '1';

        input.addEventListener(
          'keydown',
          event => {
            if (event.key !== 'Enter') return;

            const id = exactId(input.value);

            if (!id) return;

            event.preventDefault();
            event.stopImmediatePropagation();

            openProfessionalEditor(id);
          },
          true
        );
      }
    }

    const searchButton = q('#bulkSearchBtn');

    if (
      searchButton &&
      !searchButton.dataset.v195IdSearch
    ) {
      searchButton.dataset.v195IdSearch = '1';

      searchButton.addEventListener(
        'click',
        event => {
          const id = exactId(q('#bulkSearch')?.value);

          if (!id) return;

          event.preventDefault();
          event.stopImmediatePropagation();

          openProfessionalEditor(id);
        },
        true
      );
    }

    scheduleDecorate();
  }

  function scheduleDecorate() {
    clearTimeout(decorateTimer);

    decorateTimer = setTimeout(
      decorateBulkRows,
      40
    );
  }

  function decorateBulkRows() {
    qa('#bulkResults .bulk-report-row')
      .forEach(row => {
        if (q('.v195-inline-edit', row)) return;

        const check = q('.bulk-check', row);
        const id = Number(check?.value || 0);

        if (!id) return;

        const main = q('.bulk-report-main', row);

        if (!main) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'v195-inline-edit';
        button.textContent = `Editar #${id}`;

        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();
            openProfessionalEditor(id);
          }
        );

        main.appendChild(button);
      });
  }

  function exactId(value) {
    const match = String(value || '')
      .trim()
      .match(/^#?(\d+)$/);

    return match
      ? Number(match[1])
      : null;
  }

  function buildEditor() {
    if (q('#v195Editor')) return;

    const dialog = document.createElement('dialog');
    dialog.id = 'v195Editor';
    dialog.className = 'v195-dialog';

    dialog.innerHTML = `
      <div class="v195-dialog-head">
        <strong id="v195EditorTitle">Editar lançamento</strong>
        <button type="button" id="v195EditorClose">×</button>
      </div>

      <form id="v195EditorForm" class="v195-form">
        <input type="hidden" id="v195EditorId">

        <div id="v195EditorWarning" class="v195-card-warning" hidden></div>

        <div class="v195-grid-2">
          <label>
            Data
            <input id="v195EditDate" type="date" required>
          </label>

          <label>
            Tipo
            <select id="v195EditDirection">
              <option value="expense">Saída</option>
              <option value="income">Entrada</option>
              <option value="transfer">Transferência</option>
            </select>
          </label>
        </div>

        <div class="v195-grid-2">
          <label>
            Valor
            <input id="v195EditAmount" inputmode="decimal" required>
          </label>

          <label>
            Forma
            <select id="v195EditMethod">
              <option value="pix">Pix</option>
              <option value="cash">Dinheiro</option>
              <option value="debit">Débito</option>
              <option value="credit">Crédito</option>
              <option value="transfer">Transferência</option>
              <option value="boleto">Boleto</option>
              <option value="other">Outra</option>
            </select>
          </label>
        </div>

        <label>
          Descrição
          <input id="v195EditDescription" required>
        </label>

        <label>
          Natureza
          <select id="v195EditNature">
            <option value="business_operating">Empresa · operação</option>
            <option value="inventory">Empresa · compra/estoque</option>
            <option value="business_debt">Empresa · dívida</option>
            <option value="personal_withdrawal">Retirada pessoal</option>
            <option value="income">Receita</option>
            <option value="transfer">Transferência</option>
            <option value="unidentified">Não identificado</option>
          </select>
        </label>

        <label id="v195CategoryWrap">
          Categoria
          <select id="v195EditCategory"></select>
        </label>

        <label id="v195ObligationWrap">
          Conta / compromisso
          <select id="v195EditObligation"></select>
        </label>

        <label id="v195DebtWrap">
          Dívida
          <select id="v195EditDebt"></select>
        </label>

        <label id="v195SourceWrap">
          De onde saiu?
          <select id="v195EditSource"></select>
        </label>

        <label id="v195DestinationWrap">
          Onde entrou?
          <select id="v195EditDestination"></select>
        </label>

        <label>
          Observação
          <textarea id="v195EditNotes" rows="3"></textarea>
        </label>

        <div class="v195-dialog-actions">
          <button
            type="button"
            id="v195VoidBtn"
            class="v195-danger"
          >
            Cancelar lançamento
          </button>

          <button
            type="submit"
            class="v195-primary"
          >
            Salvar correção
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);

    q('#v195EditorClose').addEventListener(
      'click',
      () => dialog.close()
    );

    q('#v195EditorForm').addEventListener(
      'submit',
      saveProfessionalEditor
    );

    q('#v195VoidBtn').addEventListener(
      'click',
      voidProfessionalEditor
    );

    q('#v195EditDirection').addEventListener(
      'change',
      refreshProfessionalSelectors
    );

    q('#v195EditNature').addEventListener(
      'change',
      refreshProfessionalSelectors
    );
  }

  async function loadCatalogs() {
    if (catalogs) return catalogs;

    const [
      accounts,
      categories,
      obligations,
      debts
    ] = await Promise.all([
      api('/api/accounts'),
      api('/api/categories?all=1'),
      api('/api/obligations'),
      api('/api/debts')
    ]);

    catalogs = {
      accounts: accounts.accounts || [],
      categories: categories.categories || [],
      obligations: obligations.obligations || [],
      debts: debts.debts || []
    };

    return catalogs;
  }

  async function openProfessionalEditor(id) {
    try {
      buildEditor();

      const [
        detail
      ] = await Promise.all([
        api(`/api/v195/transactions/${id}`),
        loadCatalogs()
      ]);

      activeTransaction =
        detail.transaction;

      q('#v195EditorTitle').textContent =
        `Editar lançamento #${id}`;

      q('#v195EditorId').value =
        String(id);

      q('#v195EditDate').value =
        String(activeTransaction.occurred_at || '')
          .slice(0, 10);

      q('#v195EditDirection').value =
        activeTransaction.direction || 'expense';

      q('#v195EditAmount').value =
        centsToInput(activeTransaction.amount_cents);

      q('#v195EditDescription').value =
        activeTransaction.description || '';

      q('#v195EditNature').value =
        activeTransaction.nature || 'business_operating';

      q('#v195EditMethod').value =
        activeTransaction.payment_method || 'other';

      q('#v195EditNotes').value =
        activeTransaction.notes || '';

      refreshProfessionalSelectors();

      const warning =
        q('#v195EditorWarning');

      if (
        detail.flags
          ?.mercado_pago_credit_as_bank_expense
      ) {
        warning.hidden = false;

        warning.innerHTML = cardWarningHtml(id);
        bindCardWarningButtons(warning, id);
      } else {
        warning.hidden = true;
        warning.innerHTML = '';
      }

      q('#v195Editor').showModal();
    } catch (error) {
      notify(error.message);
    }
  }

  function refreshProfessionalSelectors() {
    if (!catalogs || !activeTransaction) return;

    const direction =
      q('#v195EditDirection').value;

    let nature =
      q('#v195EditNature').value;

    if (direction === 'income') {
      nature = 'income';
      q('#v195EditNature').value = 'income';
    }

    if (direction === 'transfer') {
      nature = 'transfer';
      q('#v195EditNature').value = 'transfer';
    }

    q('#v195EditNature').disabled =
      direction !== 'expense';

    const categories =
      catalogs.categories.filter(
        item =>
          Number(item.active) !== 0 &&
          item.nature === nature
      );

    q('#v195EditCategory').innerHTML =
      '<option value="">Sem categoria</option>' +
      categories.map(item =>
        `<option value="${item.id}">${esc(categoryLabel(item))}</option>`
      ).join('');

    const obligations =
      catalogs.obligations.filter(
        item =>
          Number(item.active) !== 0 &&
          item.nature === nature
      );

    q('#v195EditObligation').innerHTML =
      '<option value="">Nenhum / não se aplica</option>' +
      obligations.map(item =>
        `<option value="${item.id}">${esc(item.name)}</option>`
      ).join('');

    const debtScope =
      nature === 'personal_withdrawal'
        ? 'personal'
        : 'business';

    const debts =
      catalogs.debts.filter(
        item =>
          item.scope === debtScope &&
          (
            item.status === 'active' ||
            Number(item.id) ===
              Number(activeTransaction.debt_id)
          )
      );

    q('#v195EditDebt').innerHTML =
      '<option value="">Nenhuma / não se aplica</option>' +
      debts.map(item =>
        `<option value="${item.id}">${esc(item.name)}</option>`
      ).join('');

    const accountOptions =
      catalogs.accounts.map(item =>
        `<option value="${item.id}">${esc(item.name)} · ${money(item.balance_cents)}</option>`
      ).join('');

    q('#v195EditSource').innerHTML =
      accountOptions;

    q('#v195EditDestination').innerHTML =
      accountOptions;

    q('#v195SourceWrap').hidden =
      direction === 'income';

    q('#v195DestinationWrap').hidden =
      direction === 'expense';

    q('#v195ObligationWrap').hidden =
      direction !== 'expense' ||
      ![
        'business_operating',
        'inventory',
        'business_debt',
        'personal_withdrawal'
      ].includes(nature);

    q('#v195DebtWrap').hidden =
      direction !== 'expense' ||
      ![
        'business_debt',
        'personal_withdrawal'
      ].includes(nature);

    setSelectIfExists(
      q('#v195EditCategory'),
      activeTransaction.category_id
    );

    setSelectIfExists(
      q('#v195EditObligation'),
      activeTransaction.obligation_id
    );

    setSelectIfExists(
      q('#v195EditDebt'),
      activeTransaction.debt_id
    );

    setSelectIfExists(
      q('#v195EditSource'),
      activeTransaction.source_account_id
    );

    setSelectIfExists(
      q('#v195EditDestination'),
      activeTransaction.destination_account_id
    );
  }

  async function saveProfessionalEditor(event) {
    event.preventDefault();

    if (!activeTransaction) return;

    try {
      const direction =
        q('#v195EditDirection').value;

      const nature =
        q('#v195EditNature').value;

      const date =
        q('#v195EditDate').value;

      if (!date) {
        throw new Error('Informe a data.');
      }

      const payload = {
        occurred_at:
          `${date}T16:00:00.000Z`,
        direction,
        amount_cents:
          parseMoney(q('#v195EditAmount').value),
        description:
          q('#v195EditDescription').value.trim(),
        nature,
        category_id:
          nullableNumber(q('#v195EditCategory').value),
        obligation_id:
          direction === 'expense'
            ? nullableNumber(q('#v195EditObligation').value)
            : null,
        debt_id:
          direction === 'expense'
            ? nullableNumber(q('#v195EditDebt').value)
            : null,
        source_account_id:
          direction !== 'income'
            ? nullableNumber(q('#v195EditSource').value)
            : null,
        destination_account_id:
          direction !== 'expense'
            ? nullableNumber(q('#v195EditDestination').value)
            : null,
        payment_method:
          q('#v195EditMethod').value,
        notes:
          q('#v195EditNotes').value.trim() || null
      };

      await api(
        `/api/transactions/${activeTransaction.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload)
        }
      );

      q('#v195Editor').close();
      notify('Lançamento corrigido. Saldos e relatórios recalculados.');

      await refreshAfterChange();
    } catch (error) {
      notify(error.message);
    }
  }

  async function voidProfessionalEditor() {
    if (!activeTransaction) return;

    if (!confirm(
      `Cancelar este lançamento?\n\n` +
      `${activeTransaction.description} · ${money(activeTransaction.amount_cents)}\n\n` +
      `Ele deixará de afetar saldos e relatórios, mas continuará na auditoria como CANCELADO.`
    )) {
      return;
    }

    try {
      await api(
        `/api/transactions/${activeTransaction.id}`,
        {
          method: 'DELETE'
        }
      );

      q('#v195Editor').close();
      notify('Lançamento cancelado e auditoria preservada.');

      await refreshAfterChange();
    } catch (error) {
      notify(error.message);
    }
  }

  function cardWarningHtml(id) {
    return `
      <strong>Inconsistência detectada no lançamento #${id}</strong>
      Esta saída está marcada como <b>Crédito</b> e vinculada à conta
      <b>Mercado Pago</b>. Compra feita no cartão não deve reduzir o saldo
      bancário no momento da compra e não deve virar acordo societário por engano.

      <div class="v195-card-actions">
        <button
          type="button"
          class="v195-card-action"
          data-v195-move-card="business"
        >
          Mover para fatura · Empresa
        </button>

        <button
          type="button"
          class="v195-card-action personal"
          data-v195-move-card="personal"
        >
          Mover para fatura · Pessoal
        </button>
      </div>

      <div class="v195-helper">
        A operação cria a compra na fatura do Cartão Mercado Pago e cancela
        a saída bancária original, mantendo auditoria.
      </div>
    `;
  }

  function bindCardWarningButtons(root, id) {
    qa('[data-v195-move-card]', root)
      .forEach(button => {
        button.addEventListener(
          'click',
          () => moveToCard(
            id,
            button.dataset.v195MoveCard
          )
        );
      });
  }

  async function moveToCard(id, scope) {
    const label =
      scope === 'personal'
        ? 'PESSOAL'
        : 'EMPRESA';

    if (!confirm(
      `Mover o lançamento #${id} para o Cartão Mercado Pago como ${label}?\n\n` +
      `A saída bancária será cancelada e a compra será criada na fatura.`
    )) {
      return;
    }

    try {
      const result = await api(
        `/api/v195/transactions/${id}/move-to-card`,
        {
          method: 'POST',
          body: JSON.stringify({ scope })
        }
      );

      q('#v195Editor')?.close();
      q('#editTransactionDialog')?.close();

      notify(
        result.message ||
        'Lançamento movido para a fatura.'
      );

      await refreshAfterChange();
    } catch (error) {
      notify(error.message);
    }
  }

  async function refreshAfterChange() {
    catalogs = null;
    activeTransaction = null;

    q('#refreshBtn')?.click();

    setTimeout(() => {
      if (
        q('#view-pesquisa')?.classList.contains('active')
      ) {
        q('#bulkSearchBtn')?.click();
      }
    }, 650);
  }

  function enhanceExistingEditDialog() {
    const dialog = q('#editTransactionDialog');

    if (!dialog || dialog.dataset.v195Observed) {
      return;
    }

    dialog.dataset.v195Observed = '1';

    const observer = new MutationObserver(async () => {
      if (!dialog.open) {
        q('#v195LegacyWarning')?.remove();
        return;
      }

      const id =
        Number(q('#editTransactionId')?.value || 0);

      if (!id) return;

      try {
        const detail =
          await api(`/api/v195/transactions/${id}`);

        q('#v195LegacyWarning')?.remove();

        if (
          !detail.flags
            ?.mercado_pago_credit_as_bank_expense
        ) {
          return;
        }

        const warning =
          document.createElement('div');

        warning.id = 'v195LegacyWarning';
        warning.className = 'v195-card-warning';
        warning.innerHTML = cardWarningHtml(id);

        const notice =
          q('#editOpeningNotice', dialog);

        notice?.insertAdjacentElement(
          'afterend',
          warning
        );

        bindCardWarningButtons(
          warning,
          id
        );
      } catch {
        /* Não bloqueia a edição original. */
      }
    });

    observer.observe(
      dialog,
      {
        attributes: true,
        attributeFilter: ['open']
      }
    );
  }

  function categoryLabel(item) {
    return item.parent_name
      ? `${item.parent_name} › ${item.name}`
      : item.name;
  }

  function setSelectIfExists(select, value) {
    if (
      value != null &&
      [...select.options].some(
        option =>
          Number(option.value) === Number(value)
      )
    ) {
      select.value = String(value);
    }
  }

  function nullableNumber(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0
      ? n
      : null;
  }

  function parseMoney(value) {
    let s = String(value || '')
      .trim()
      .replace(/R\$/gi, '')
      .replace(/\s/g, '');

    if (!s) return 0;

    if (
      s.includes(',') &&
      s.includes('.')
    ) {
      s = s
        .replace(/\./g, '')
        .replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if (
      (s.match(/\./g) || []).length > 1
    ) {
      s = s.replace(/\./g, '');
    } else if (
      /^\d{1,3}\.\d{3}$/.test(s)
    ) {
      s = s.replace('.', '');
    }

    const n = Number(s);

    return Number.isFinite(n)
      ? Math.round(n * 100)
      : 0;
  }

  function centsToInput(cents) {
    return (
      Number(cents || 0) / 100
    )
      .toFixed(2)
      .replace('.', ',');
  }

  function startObservers() {
    const bulk = q('#bulkResults');

    if (bulk && !bulk.dataset.v195Observed) {
      bulk.dataset.v195Observed = '1';

      new MutationObserver(
        scheduleDecorate
      ).observe(
        bulk,
        {
          childList: true,
          subtree: true
        }
      );
    }

    enhanceExistingEditDialog();
  }

  function start() {
    injectStyles();
    buildEditor();
    applyVersion();
    addMovementSearch();
    enhanceBulkSearch();
    startObservers();

    setTimeout(applyVersion, 0);
    setTimeout(applyVersion, 250);
    setTimeout(applyVersion, 1000);
    setTimeout(addMovementSearch, 500);
    setTimeout(enhanceBulkSearch, 500);
    setTimeout(startObservers, 500);

    new MutationObserver(() => {
      applyVersion();
      addMovementSearch();
      enhanceBulkSearch();
      startObservers();
    }).observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
