(() => {
  'use strict';

  const VERSION = '1.9.4';

  function $(id) {
    return document.getElementById(id);
  }

  function norm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toast(message) {
    const el = $('toast');

    if (el) {
      el.textContent = message;
      el.hidden = false;

      clearTimeout(window.__pf194ToastTimer);

      window.__pf194ToastTimer = setTimeout(() => {
        el.hidden = true;
      }, 4200);

      return;
    }

    alert(message);
  }

  function applyVersion() {
    const footer =
      document.querySelector('.sidebar-foot strong');

    if (footer) {
      footer.textContent = `v${VERSION}`;
    }

    document.documentElement.dataset.appVersion =
      VERSION;

    window.PANTANEIRA_FINANCEIRO_VERSION =
      VERSION;
  }

  function injectStyles() {
    if ($('pf194ProfessionalStyles')) return;

    const style =
      document.createElement('style');

    style.id =
      'pf194ProfessionalStyles';

    style.textContent = `
      .pf194-search-card{
        margin:12px 0 14px;
        padding:12px;
        background:#fff;
        border:1px solid #dfe4ed;
        border-radius:15px;
        box-shadow:0 4px 14px rgba(27,39,65,.03)
      }

      .pf194-search-head{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:12px;
        margin-bottom:8px
      }

      .pf194-search-head strong{
        color:#172136;
        font-size:13px
      }

      .pf194-search-head small{
        color:#7f8a9c;
        font-size:9px
      }

      .pf194-search-row{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto auto;
        gap:8px
      }

      .pf194-search-row input{
        width:100%;
        min-width:0;
        padding:10px 11px;
        border:1px solid #d9dfe8;
        border-radius:11px;
        background:#fff;
        color:#172136
      }

      .pf194-search-row button{
        min-height:40px;
        padding:8px 12px;
        border-radius:10px;
        font-weight:800;
        cursor:pointer
      }

      .pf194-search-go{
        border:0;
        background:#4057e8;
        color:#fff
      }

      .pf194-search-advanced{
        border:1px solid #dce2eb;
        background:#f7f9fc;
        color:#49566d
      }

      .pf194-inline-edit{
        margin-top:7px;
        padding:6px 9px;
        border:0;
        border-radius:8px;
        background:#eef1ff;
        color:#4057e8;
        font-size:9px;
        font-weight:800;
        cursor:pointer
      }

      .pf194-warning{
        margin:0 0 10px;
        padding:10px 12px;
        border:1px solid #ead79d;
        border-radius:12px;
        background:#fff7df;
        color:#634d0e;
        font-size:10px;
        line-height:1.45
      }

      .pf194-warning strong{
        color:#463500
      }

      @media(max-width:700px){
        .pf194-search-head{
          display:block
        }

        .pf194-search-head small{
          display:block;
          margin-top:3px
        }

        .pf194-search-row{
          grid-template-columns:1fr 1fr
        }

        .pf194-search-row input{
          grid-column:1/-1
        }
      }
    `;

    document.head.appendChild(style);
  }

  function openAdvancedSearch(term = '') {
    if (
      typeof window.openBulkReclassPage !==
      'function'
    ) {
      toast(
        'Pesquisa avançada ainda não carregou.'
      );
      return;
    }

    window.openBulkReclassPage();

    setTimeout(() => {
      const input = $('bulkSearch');

      if (input) {
        input.value = term;
      }

      if (
        typeof window.searchBulkTransactions ===
        'function'
      ) {
        window.searchBulkTransactions();
      }

      setTimeout(
        decorateBulkResults,
        80
      );
    }, 80);
  }

  function tryOpenById(id) {
    if (
      typeof window.openTransactionEditor !==
      'function'
    ) {
      return false;
    }

    const dialog =
      $('editTransactionDialog');

    const before =
      Boolean(dialog?.open);

    window.openTransactionEditor(
      Number(id)
    );

    const after =
      Boolean(dialog?.open);

    if (!before && !after) {
      return false;
    }

    return true;
  }

  function runQuickSearch() {
    const input =
      $('pf194QuickMovementInput');

    const term =
      String(
        input?.value || ''
      ).trim();

    if (!term) {
      input?.focus();
      return;
    }

    const idMatch =
      term.match(/^#?(\d+)$/);

    if (idMatch) {
      const id =
        Number(idMatch[1]);

      if (tryOpenById(id)) {
        return;
      }

      openAdvancedSearch(term);
      return;
    }

    openAdvancedSearch(term);
  }

  function installQuickSearch() {
    if (
      $('pf194QuickMovementSearch')
    ) {
      return;
    }

    const heading =
      document.querySelector(
        '#view-lancar .page-heading'
      );

    if (!heading) return;

    const card =
      document.createElement('div');

    card.id =
      'pf194QuickMovementSearch';

    card.className =
      'pf194-search-card';

    card.innerHTML = `
      <div class="pf194-search-head">
        <strong>
          Pesquisar movimentos
        </strong>

        <small>
          #ID, descrição, conta, categoria ou valor
        </small>
      </div>

      <div class="pf194-search-row">
        <input
          id="pf194QuickMovementInput"
          autocomplete="off"
          placeholder="Ex.: #96, marmita, Mercado Pago, 315,89"
        >

        <button
          id="pf194QuickMovementBtn"
          type="button"
          class="pf194-search-go"
        >
          Pesquisar
        </button>

        <button
          id="pf194AdvancedMovementBtn"
          type="button"
          class="pf194-search-advanced"
        >
          Filtros
        </button>
      </div>
    `;

    heading.insertAdjacentElement(
      'afterend',
      card
    );

    $('pf194QuickMovementBtn')
      ?.addEventListener(
        'click',
        runQuickSearch
      );

    $('pf194AdvancedMovementBtn')
      ?.addEventListener(
        'click',
        () => {
          openAdvancedSearch(
            String(
              $('pf194QuickMovementInput')
                ?.value || ''
            ).trim()
          );
        }
      );

    $('pf194QuickMovementInput')
      ?.addEventListener(
        'keydown',
        event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            runQuickSearch();
          }
        }
      );
  }

  function decorateBulkResults() {
    document
      .querySelectorAll(
        '#bulkResults .bulk-report-row'
      )
      .forEach(row => {
        if (
          row.querySelector(
            '.pf194-inline-edit'
          )
        ) {
          return;
        }

        const checkbox =
          row.querySelector(
            '.bulk-check'
          );

        const id =
          Number(
            checkbox?.value || 0
          );

        if (!id) return;

        const main =
          row.querySelector(
            '.bulk-report-main'
          );

        if (!main) return;

        const button =
          document.createElement(
            'button'
          );

        button.type =
          'button';

        button.className =
          'pf194-inline-edit';

        button.textContent =
          `Editar #${id}`;

        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();

            if (!tryOpenById(id)) {
              toast(
                `O lançamento #${id} foi encontrado, mas não está carregado no editor atual. Use os filtros e abra-o pela lista de movimentos.`
              );
            }
          }
        );

        main.appendChild(button);
      });
  }

  function selectedText(id) {
    const select =
      $(id);

    if (!select) return '';

    return String(
      select.selectedOptions?.[0]
        ?.textContent || ''
    ).trim();
  }

  function isMercadoPagoCreditExpense(
    prefix
  ) {
    const direction =
      $(prefix + 'Direction')
        ?.value;

    const paymentMethod =
      $(prefix + 'PaymentMethod')
        ?.value;

    let sourceText = '';

    if (prefix === 'edit') {
      sourceText =
        selectedText(
          'editSourceAccount'
        );
    } else {
      sourceText =
        selectedText(
          'sourceAccount'
        );
    }

    return (
      direction === 'expense' &&
      paymentMethod === 'credit' &&
      norm(sourceText)
        .includes(
          'mercado pago'
        )
    );
  }

  function ensureEditorWarning() {
    const dialog =
      $('editTransactionDialog');

    if (!dialog) return null;

    let warning =
      $('pf194MercadoPagoWarning');

    if (!warning) {
      warning =
        document.createElement(
          'div'
        );

      warning.id =
        'pf194MercadoPagoWarning';

      warning.className =
        'pf194-warning';

      warning.hidden =
        true;

      const openingNotice =
        $('editOpeningNotice');

      if (openingNotice) {
        openingNotice
          .insertAdjacentElement(
            'afterend',
            warning
          );
      } else {
        const body =
          dialog.querySelector(
            '.dialog-body, form'
          );

        if (body) {
          body.prepend(warning);
        }
      }
    }

    return warning;
  }

  function refreshEditorWarning() {
    const warning =
      ensureEditorWarning();

    if (!warning) return;

    const invalid =
      isMercadoPagoCreditExpense(
        'edit'
      );

    warning.hidden =
      !invalid;

    warning.innerHTML =
      invalid
        ? `
          <strong>
            Inconsistência detectada.
          </strong>
          <br>
          A forma está como <b>Crédito</b>,
          mas a saída está vinculada à
          <b>conta Mercado Pago</b>.
          Compra feita no cartão deve ir
          para a fatura; não deve reduzir
          o saldo bancário no momento da compra.
          Para um lançamento antigo incorreto,
          use <b>Cancelar lançamento</b>
          e depois registre a compra na
          fatura correta.
        `
        : '';
  }

  function installMercadoPagoGuards() {
    const editForm =
      $('editTransactionForm');

    if (
      editForm &&
      !editForm.dataset.pf194Guard
    ) {
      editForm.dataset.pf194Guard =
        '1';

      editForm.addEventListener(
        'submit',
        event => {
          if (
            !isMercadoPagoCreditExpense(
              'edit'
            )
          ) {
            return;
          }

          event.preventDefault();
          event.stopImmediatePropagation();

          refreshEditorWarning();

          toast(
            'Bloqueado: compra no cartão Mercado Pago não pode sair da conta bancária Mercado Pago.'
          );
        },
        true
      );
    }

    const newForm =
      $('transactionForm');

    if (
      newForm &&
      !newForm.dataset.pf194Guard
    ) {
      newForm.dataset.pf194Guard =
        '1';

      newForm.addEventListener(
        'submit',
        event => {
          const direction =
            $('direction')
              ?.value;

          const paymentMethod =
            $('paymentMethod')
              ?.value;

          const source =
            selectedText(
              'sourceAccount'
            );

          const invalid =
            direction ===
              'expense' &&
            paymentMethod ===
              'credit' &&
            norm(source)
              .includes(
                'mercado pago'
              );

          if (!invalid) {
            return;
          }

          event.preventDefault();
          event.stopImmediatePropagation();

          toast(
            'Bloqueado: compra no cartão Mercado Pago deve ser registrada na fatura, não como saída da conta Mercado Pago.'
          );
        },
        true
      );
    }

    [
      'editDirection',
      'editPaymentMethod',
      'editSourceAccount'
    ].forEach(id => {
      const el =
        $(id);

      if (
        el &&
        !el.dataset.pf194Warning
      ) {
        el.dataset.pf194Warning =
          '1';

        el.addEventListener(
          'change',
          refreshEditorWarning
        );
      }
    });

    const dialog =
      $('editTransactionDialog');

    if (
      dialog &&
      !dialog.dataset.pf194Observed
    ) {
      dialog.dataset.pf194Observed =
        '1';

      new MutationObserver(
        () => {
          if (dialog.open) {
            setTimeout(
              refreshEditorWarning,
              0
            );
          }
        }
      ).observe(
        dialog,
        {
          attributes: true,
          attributeFilter: [
            'open'
          ]
        }
      );
    }
  }

  function installBulkObserver() {
    const host =
      $('bulkResults');

    if (
      !host ||
      host.dataset.pf194Observed
    ) {
      return;
    }

    host.dataset.pf194Observed =
      '1';

    new MutationObserver(
      () => {
        setTimeout(
          decorateBulkResults,
          0
        );
      }
    ).observe(
      host,
      {
        childList: true,
        subtree: true
      }
    );

    decorateBulkResults();
  }

  function start() {
    applyVersion();
    injectStyles();
    installQuickSearch();
    installMercadoPagoGuards();
    installBulkObserver();

    setTimeout(
      applyVersion,
      250
    );

    setTimeout(
      installQuickSearch,
      350
    );

    setTimeout(
      installMercadoPagoGuards,
      350
    );

    setTimeout(
      installBulkObserver,
      350
    );

    new MutationObserver(
      () => {
        applyVersion();
        installQuickSearch();
        installMercadoPagoGuards();
        installBulkObserver();
      }
    ).observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }
})();
