(() => {
  'use strict';

  const VERSION = '1.9.4';
  const LIMIT = 500;
  const TZ = 'America/Cuiaba';

  let accounts = [];
  let categories = [];
  let obligations = [];
  let debts = [];
  let currentRows = [];
  let editing = null;

  const $ = (id) => document.getElementById(id);

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);

  const norm = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const money = (cents) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(Number(cents || 0) / 100);

  const centsInput = (cents) =>
    (Number(cents || 0) / 100).toFixed(2).replace('.', ',');

  function parseMoney(value) {
    let s = String(value ?? '').trim().replace(/\s/g, '');
    if (!s) return 0;

    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
      s = s.replace('.', '');
    }

    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  function localYmd() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const map = Object.fromEntries(
      parts
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    );

    return `${map.year}-${map.month}-${map.day}`;
  }

  function monthStart(ymd) {
    return `${ymd.slice(0, 7)}-01`;
  }

  function dateBR(value) {
    const s = String(value || '').slice(0, 10);
    const [y, m, d] = s.split('-');
    return y && m && d ? `${d}/${m}/${y}` : s;
  }

  function timeBR(value) {
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return '';
    }
  }

  function paymentLabel(value) {
    return ({
      pix: 'Pix',
      cash: 'Dinheiro',
      debit: 'Débito',
      credit: 'Crédito',
      transfer: 'Transferência',
      boleto: 'Boleto',
      other: 'Outra'
    })[value] || 'Não informado';
  }

  function directionLabel(value) {
    return ({
      income: 'Entrada',
      expense: 'Saída',
      transfer: 'Transferência'
    })[value] || value;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    let data = {};

    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      const error = new Error(
        data.error || `Erro ${response.status}`
      );

      error.status = response.status;
      throw error;
    }

    return data;
  }

  function notify(message) {
    const toast = $('toast');

    if (toast) {
      toast.textContent = message;
      toast.hidden = false;

      clearTimeout(window.__pfConcToast);

      window.__pfConcToast = setTimeout(() => {
        toast.hidden = true;
      }, 4200);

      return;
    }

    alert(message);
  }

  function applyVersion() {
    const footer =
      document.querySelector('.sidebar-foot strong');

    if (
      footer &&
      footer.textContent !== `v${VERSION}`
    ) {
      footer.textContent = `v${VERSION}`;
    }

    document.documentElement.dataset.appVersion =
      VERSION;

    window.PANTANEIRA_FINANCEIRO_VERSION =
      VERSION;
  }

  function injectStyles() {
    if ($('pfConcStyles')) return;

    const style =
      document.createElement('style');

    style.id = 'pfConcStyles';

    style.textContent = `
      .pf-conc-page{
        max-width:1320px;
        margin:0 auto
      }

      .pf-conc-head{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:18px;
        margin-bottom:18px
      }

      .pf-conc-head h1{
        margin:3px 0 4px;
        font-size:28px;
        letter-spacing:-.035em;
        color:#172136
      }

      .pf-conc-head p{
        margin:0;
        color:#7d889a
      }

      .pf-conc-tabs{
        display:flex;
        gap:7px;
        margin:0 0 15px;
        padding:5px;
        background:#eef2f7;
        border-radius:13px
      }

      .pf-conc-tabs button{
        flex:1;
        border:0;
        border-radius:9px;
        padding:10px;
        background:transparent;
        color:#68758b;
        font-weight:800;
        cursor:pointer
      }

      .pf-conc-tabs button.active{
        background:#fff;
        color:#4057e8;
        box-shadow:0 3px 10px rgba(27,39,65,.06)
      }

      .pf-conc-panel{
        display:none
      }

      .pf-conc-panel.active{
        display:block
      }

      .pf-conc-card{
        background:#fff;
        border:1px solid #dfe4ed;
        border-radius:18px;
        padding:16px;
        box-shadow:0 5px 16px rgba(27,39,65,.035)
      }

      .pf-conc-filter-grid{
        display:grid;
        grid-template-columns:minmax(220px,2fr) 1fr 1fr 1fr 1fr;
        gap:10px
      }

      .pf-conc-filter-grid label,
      .pf-conc-bank-grid label,
      .pf-conc-editor label{
        display:grid;
        gap:5px;
        color:#556176;
        font-size:9px;
        font-weight:800
      }

      .pf-conc-filter-grid input,
      .pf-conc-filter-grid select,
      .pf-conc-bank-grid input,
      .pf-conc-bank-grid select,
      .pf-conc-editor input,
      .pf-conc-editor select,
      .pf-conc-editor textarea{
        width:100%;
        min-width:0;
        padding:10px 11px;
        border:1px solid #d9dfe8;
        border-radius:11px;
        background:#fff;
        color:#172136
      }

      .pf-conc-actions{
        display:flex;
        justify-content:flex-end;
        gap:8px;
        margin-top:11px;
        flex-wrap:wrap
      }

      .pf-conc-btn{
        border:1px solid #dbe1e9;
        border-radius:10px;
        padding:9px 13px;
        background:#fff;
        color:#33405a;
        font-weight:800;
        cursor:pointer
      }

      .pf-conc-btn.primary{
        border-color:#4057e8;
        background:#4057e8;
        color:#fff
      }

      .pf-conc-btn.danger{
        border-color:#e2a7a3;
        color:#b64038
      }

      .pf-conc-summary{
        display:grid;
        grid-template-columns:repeat(4,1fr);
        gap:9px;
        margin:13px 0
      }

      .pf-conc-summary>div{
        padding:11px 12px;
        border:1px solid #e4e8ef;
        border-radius:13px;
        background:#fff
      }

      .pf-conc-summary span{
        display:block;
        color:#8a94a5;
        font-size:8px;
        font-weight:750;
        text-transform:uppercase;
        letter-spacing:.08em
      }

      .pf-conc-summary strong{
        display:block;
        margin-top:3px;
        font-size:15px;
        color:#172136
      }

      .pf-conc-table-wrap{
        overflow:auto;
        background:#fff;
        border:1px solid #dfe4ed;
        border-radius:18px
      }

      .pf-conc-table{
        width:100%;
        border-collapse:collapse;
        min-width:980px
      }

      .pf-conc-table th{
        position:sticky;
        top:0;
        background:#f7f9fc;
        color:#758197;
        font-size:8px;
        text-align:left;
        padding:10px;
        border-bottom:1px solid #e4e8ef;
        z-index:1
      }

      .pf-conc-table td{
        padding:10px;
        border-bottom:1px solid #edf0f4;
        vertical-align:middle;
        font-size:10px;
        color:#344057
      }

      .pf-conc-table tr:last-child td{
        border-bottom:0
      }

      .pf-conc-desc strong{
        display:block;
        color:#172136;
        font-size:10px
      }

      .pf-conc-desc small{
        display:block;
        margin-top:2px;
        color:#8a94a5;
        font-size:8px
      }

      .pf-conc-value{
        font-weight:850;
        white-space:nowrap
      }

      .pf-conc-value.income{
        color:#138447
      }

      .pf-conc-value.expense{
        color:#c74640
      }

      .pf-conc-status{
        display:inline-flex;
        padding:4px 7px;
        border-radius:999px;
        font-size:8px;
        font-weight:800
      }

      .pf-conc-status.active{
        background:#eaf8ef;
        color:#147b42
      }

      .pf-conc-status.void{
        background:#fff0ef;
        color:#b64038
      }

      .pf-conc-empty{
        padding:22px;
        color:#818c9e;
        text-align:center
      }

      .pf-conc-bank-grid{
        display:grid;
        grid-template-columns:1fr 1fr 1fr;
        gap:10px
      }

      .pf-conc-diff{
        margin-top:12px;
        padding:14px;
        border-radius:14px;
        background:#f7f9fc;
        border:1px solid #e2e6ed
      }

      .pf-conc-diff strong{
        display:block;
        font-size:22px;
        color:#172136
      }

      .pf-conc-diff small{
        color:#7e899b
      }

      .pf-conc-warning{
        padding:11px 12px;
        border:1px solid #ead79d;
        border-radius:12px;
        background:#fff7df;
        color:#634d0e;
        font-size:10px;
        line-height:1.45
      }

      .pf-conc-dialog{
        width:min(94vw,720px);
        max-height:90vh;
        padding:0;
        border:0;
        border-radius:18px;
        box-shadow:0 24px 70px rgba(17,24,39,.26)
      }

      .pf-conc-dialog::backdrop{
        background:rgba(17,24,39,.42)
      }

      .pf-conc-dialog-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:15px 16px;
        border-bottom:1px solid #e7ebf1
      }

      .pf-conc-dialog-head strong{
        font-size:15px;
        color:#172136
      }

      .pf-conc-dialog-head button{
        width:32px;
        height:32px;
        border:0;
        border-radius:10px;
        background:#f0f3f7;
        cursor:pointer
      }

      .pf-conc-editor{
        display:grid;
        gap:10px;
        padding:16px;
        max-height:calc(90vh - 63px);
        overflow:auto
      }

      .pf-conc-grid2{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:9px
      }

      .pf-conc-launch{
        margin:10px 0 0
      }

      .pf-conc-open-btn{
        display:inline-flex;
        align-items:center;
        gap:7px
      }

      @media(max-width:979px){
        .pf-conc-page{
          width:100%;
          max-width:100%
        }

        .pf-conc-head h1{
          font-size:21px
        }

        .pf-conc-head p{
          font-size:9px
        }

        .pf-conc-tabs{
          overflow:auto
        }

        .pf-conc-tabs button{
          white-space:nowrap;
          min-width:120px
        }

        .pf-conc-filter-grid{
          grid-template-columns:1fr 1fr
        }

        .pf-conc-filter-grid label:first-child{
          grid-column:1/-1
        }

        .pf-conc-summary{
          grid-template-columns:1fr 1fr
        }

        .pf-conc-bank-grid{
          grid-template-columns:1fr
        }

        .pf-conc-launch{
          display:block
        }
      }

      @media(max-width:560px){
        .pf-conc-filter-grid{
          grid-template-columns:1fr
        }

        .pf-conc-filter-grid label:first-child{
          grid-column:auto
        }

        .pf-conc-grid2{
          grid-template-columns:1fr
        }

        .pf-conc-actions{
          justify-content:stretch
        }

        .pf-conc-actions .pf-conc-btn{
          flex:1
        }
      }

      @media print{
        .desktop-sidebar,
        .topbar,
        .bottom-nav,
        .fab,
        .pf-conc-tabs,
        .pf-conc-filter-card,
        .pf-conc-actions{
          display:none!important
        }

        main{
          padding:0!important
        }

        .view{
          display:none!important
        }

        #view-conciliacao{
          display:block!important
        }

        .pf-conc-table-wrap{
          border:0;
          overflow:visible
        }

        .pf-conc-table{
          min-width:0;
          font-size:9px
        }
      }
    `;

    document.head.appendChild(style);
  }

  function injectNavigation() {
    if (
      !document.querySelector(
        '.pf-conc-sidebar-btn'
      )
    ) {
      const movementButton =
        [...document.querySelectorAll(
          '.sidebar-nav button'
        )].find(
          (button) =>
            norm(
              button.textContent
            ).includes(
              'movimentos'
            )
        );

      if (movementButton) {
        const button =
          document.createElement(
            'button'
          );

        button.type = 'button';
        button.className =
          'pf-conc-sidebar-btn';

        button.dataset.view =
          'conciliacao';

        button.innerHTML =
          '<span>⌕</span><b>Conciliação</b>';

        button.addEventListener(
          'click',
          openConciliation
        );

        movementButton
          .insertAdjacentElement(
            'afterend',
            button
          );
      }
    }

    if (
      !$('pfConcOpenFromMovements')
    ) {
      const heading =
        document.querySelector(
          '#view-lancar .page-heading'
        );

      if (heading) {
        const wrap =
          document.createElement(
            'div'
          );

        wrap.id =
          'pfConcOpenFromMovements';

        wrap.className =
          'pf-conc-launch';

        wrap.innerHTML = `
          <button
            type="button"
            class="btn secondary pf-conc-open-btn"
          >
            <span>⌕</span>
            Abrir Conciliação
          </button>
        `;

        wrap
          .querySelector('button')
          .addEventListener(
            'click',
            openConciliation
          );

        heading
          .insertAdjacentElement(
            'afterend',
            wrap
          );
      }
    }
  }

  function injectPage() {
    if ($('view-conciliacao')) {
      return;
    }

    const main =
      document.querySelector('main');

    if (!main) return;

    const today =
      localYmd();

    const first =
      monthStart(today);

    const section =
      document.createElement(
        'section'
      );

    section.id =
      'view-conciliacao';

    section.className =
      'view';

    section.innerHTML = `
      <div class="pf-conc-page">
        <div class="pf-conc-head">
          <div>
            <span class="page-kicker">
              CONTROLE E AUDITORIA
            </span>

            <h1>
              Conciliação
            </h1>

            <p>
              Localize, confira e corrija lançamentos sem procurar manualmente na página.
            </p>
          </div>
        </div>

        <div class="pf-conc-tabs">
          <button
            type="button"
            class="active"
            data-conc-tab="movimentos"
          >
            Buscar lançamentos
          </button>

          <button
            type="button"
            data-conc-tab="bancaria"
          >
            Conciliação bancária
          </button>

          <button
            type="button"
            data-conc-tab="auditoria"
          >
            Auditoria
          </button>
        </div>

        <section
          id="pfConcPanelMovimentos"
          class="pf-conc-panel active"
        >
          <article
            class="pf-conc-card pf-conc-filter-card"
          >
            <div class="pf-conc-filter-grid">
              <label>
                Busca global

                <input
                  id="pfConcSearch"
                  placeholder="#88, 315,89, Mercado Pago, marmita, acordo..."
                  autocomplete="off"
                >
              </label>

              <label>
                Conta

                <select id="pfConcAccount">
                  <option value="">
                    Todas
                  </option>
                </select>
              </label>

              <label>
                Data inicial

                <input
                  id="pfConcFrom"
                  type="date"
                  value="${first}"
                >
              </label>

              <label>
                Data final

                <input
                  id="pfConcTo"
                  type="date"
                  value="${today}"
                >
              </label>

              <label>
                Status

                <select id="pfConcStatus">
                  <option value="active">
                    Ativos
                  </option>

                  <option value="all">
                    Todos
                  </option>

                  <option value="void">
                    Cancelados
                  </option>
                </select>
              </label>

              <label>
                Tipo

                <select id="pfConcDirection">
                  <option value="">
                    Todos
                  </option>

                  <option value="income">
                    Entrada
                  </option>

                  <option value="expense">
                    Saída
                  </option>

                  <option value="transfer">
                    Transferência
                  </option>
                </select>
              </label>

              <label>
                Categoria

                <select id="pfConcCategory">
                  <option value="">
                    Todas
                  </option>
                </select>
              </label>
            </div>

            <div class="pf-conc-actions">
              <button
                type="button"
                id="pfConcClear"
                class="pf-conc-btn"
              >
                Limpar
              </button>

              <button
                type="button"
                id="pfConcCsv"
                class="pf-conc-btn"
              >
                Baixar CSV
              </button>

              <button
                type="button"
                id="pfConcPrint"
                class="pf-conc-btn"
              >
                Imprimir / PDF
              </button>

              <button
                type="button"
                id="pfConcSearchBtn"
                class="pf-conc-btn primary"
              >
                Pesquisar
              </button>
            </div>
          </article>

          <div class="pf-conc-summary">
            <div>
              <span>
                Resultados
              </span>

              <strong id="pfConcCount">
                0
              </strong>
            </div>

            <div>
              <span>
                Entradas
              </span>

              <strong id="pfConcIncome">
                R$ 0,00
              </strong>
            </div>

            <div>
              <span>
                Saídas
              </span>

              <strong id="pfConcExpense">
                R$ 0,00
              </strong>
            </div>

            <div>
              <span>
                Saldo do filtro
              </span>

              <strong id="pfConcNet">
                R$ 0,00
              </strong>
            </div>
          </div>

          <div class="pf-conc-table-wrap">
            <table class="pf-conc-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>ID</th>
                  <th>Descrição</th>
                  <th>Conta</th>
                  <th>Categoria</th>
                  <th>Forma</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Ação</th>
                </tr>
              </thead>

              <tbody id="pfConcRows">
                <tr>
                  <td
                    colspan="9"
                    class="pf-conc-empty"
                  >
                    Use a busca ou os filtros.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          id="pfConcPanelBancaria"
          class="pf-conc-panel"
        >
          <article class="pf-conc-card">
            <div class="pf-conc-bank-grid">
              <label>
                Conta

                <select id="pfBankAccount">
                  <option value="">
                    Selecione
                  </option>
                </select>
              </label>

              <label>
                Saldo real no banco

                <input
                  id="pfBankActual"
                  inputmode="decimal"
                  placeholder="0,00"
                >
              </label>

              <label>
                Motivo

                <input
                  id="pfBankReason"
                  value="Conciliação com extrato bancário"
                >
              </label>
            </div>

            <div class="pf-conc-diff">
              <small>
                Saldo do Financeiro
              </small>

              <strong id="pfBankAppBalance">
                R$ 0,00
              </strong>

              <small id="pfBankDiffText">
                Informe o saldo real para calcular a diferença.
              </small>
            </div>

            <div
              class="pf-conc-warning"
              style="margin-top:12px"
            >
              Antes de registrar um ajuste de saldo,
              pesquise os movimentos da conta e procure
              lançamentos faltantes, duplicados ou
              classificados na conta errada.
            </div>

            <div class="pf-conc-actions">
              <button
                type="button"
                id="pfBankAnalyze"
                class="pf-conc-btn"
              >
                Analisar movimentos desta conta
              </button>

              <button
                type="button"
                id="pfBankReconcile"
                class="pf-conc-btn primary"
              >
                Registrar conciliação
              </button>
            </div>
          </article>
        </section>

        <section
          id="pfConcPanelAuditoria"
          class="pf-conc-panel"
        >
          <article class="pf-conc-card">
            <div class="pf-conc-warning">
              Auditoria mostra lançamentos cancelados.
              Eles permanecem registrados, mas não afetam
              os saldos e relatórios ativos.
            </div>

            <div class="pf-conc-actions">
              <button
                type="button"
                id="pfAuditLoad"
                class="pf-conc-btn primary"
              >
                Carregar cancelados
              </button>
            </div>
          </article>

          <div
            class="pf-conc-table-wrap"
            style="margin-top:13px"
          >
            <table class="pf-conc-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>ID</th>
                  <th>Descrição</th>
                  <th>Conta</th>
                  <th>Categoria</th>
                  <th>Forma</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Ação</th>
                </tr>
              </thead>

              <tbody id="pfAuditRows">
                <tr>
                  <td
                    colspan="9"
                    class="pf-conc-empty"
                  >
                    Clique em “Carregar cancelados”.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    main.appendChild(section);
  }

  function buildEditor() {
    if ($('pfConcEditorDialog')) {
      return;
    }

    const dialog =
      document.createElement(
        'dialog'
      );

    dialog.id =
      'pfConcEditorDialog';

    dialog.className =
      'pf-conc-dialog';

    dialog.innerHTML = `
      <div class="pf-conc-dialog-head">
        <strong id="pfConcEditorTitle">
          Editar lançamento
        </strong>

        <button
          type="button"
          id="pfConcEditorClose"
        >
          ×
        </button>
      </div>

      <form
        id="pfConcEditorForm"
        class="pf-conc-editor"
      >
        <div
          id="pfConcEditorWarning"
          class="pf-conc-warning"
          hidden
        ></div>

        <div class="pf-conc-grid2">
          <label>
            Data

            <input
              id="pfEditDate"
              type="date"
              required
            >
          </label>

          <label>
            Valor

            <input
              id="pfEditAmount"
              inputmode="decimal"
              required
            >
          </label>
        </div>

        <label>
          Descrição

          <input
            id="pfEditDescription"
            required
          >
        </label>

        <div class="pf-conc-grid2">
          <label>
            Tipo

            <select id="pfEditDirection">
              <option value="expense">
                Saída
              </option>

              <option value="income">
                Entrada
              </option>

              <option value="transfer">
                Transferência
              </option>
            </select>
          </label>

          <label>
            Natureza

            <select id="pfEditNature">
              <option value="business_operating">
                Empresa · operação
              </option>

              <option value="inventory">
                Empresa · compra/estoque
              </option>

              <option value="business_debt">
                Empresa · dívida
              </option>

              <option value="personal_withdrawal">
                Retirada pessoal
              </option>

              <option value="income">
                Receita
              </option>

              <option value="transfer">
                Transferência
              </option>

              <option value="unidentified">
                Não identificado
              </option>
            </select>
          </label>
        </div>

        <label>
          Categoria

          <select id="pfEditCategory"></select>
        </label>

        <div id="pfEditObligationWrap">
          <label>
            Conta / compromisso

            <select id="pfEditObligation"></select>
          </label>
        </div>

        <div id="pfEditDebtWrap">
          <label>
            Dívida

            <select id="pfEditDebt"></select>
          </label>
        </div>

        <div id="pfEditSourceWrap">
          <label>
            De onde saiu?

            <select id="pfEditSource"></select>
          </label>
        </div>

        <div id="pfEditDestinationWrap">
          <label>
            Onde entrou?

            <select id="pfEditDestination"></select>
          </label>
        </div>

        <label>
          Forma

          <select id="pfEditMethod">
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
          Observação

          <textarea
            id="pfEditNotes"
            rows="3"
          ></textarea>
        </label>

        <div class="pf-conc-actions">
          <button
            type="button"
            id="pfEditCancelTransaction"
            class="pf-conc-btn danger"
          >
            Cancelar lançamento
          </button>

          <button
            type="submit"
            class="pf-conc-btn primary"
          >
            Salvar alterações
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(
      dialog
    );

    $('pfConcEditorClose')
      .addEventListener(
        'click',
        () => dialog.close()
      );

    $('pfConcEditorForm')
      .addEventListener(
        'submit',
        saveEdit
      );

    $('pfEditCancelTransaction')
      .addEventListener(
        'click',
        cancelTransaction
      );

    $('pfEditDirection')
      .addEventListener(
        'change',
        renderEditSelectors
      );

    $('pfEditNature')
      .addEventListener(
        'change',
        renderEditSelectors
      );

    $('pfEditMethod')
      .addEventListener(
        'change',
        refreshEditWarning
      );

    $('pfEditSource')
      .addEventListener(
        'change',
        refreshEditWarning
      );
  }

  async function loadCatalogs() {
    const [
      accountData,
      categoryData,
      obligationData,
      debtData
    ] = await Promise.all([
      api('/api/accounts'),
      api('/api/categories?all=1'),
      api('/api/obligations'),
      api('/api/debts')
    ]);

    accounts =
      accountData.accounts || [];

    categories =
      categoryData.categories || [];

    obligations =
      obligationData.obligations || [];

    debts =
      debtData.debts || [];

    fillMainSelectors();
  }

  function fillMainSelectors() {
    if ($('pfConcAccount')) {
      $('pfConcAccount')
        .innerHTML =
          '<option value="">Todas</option>' +
          accounts
            .map(
              (a) =>
                `<option value="${a.id}">
                  ${esc(a.name)}
                </option>`
            )
            .join('');
    }

    if ($('pfBankAccount')) {
      $('pfBankAccount')
        .innerHTML =
          '<option value="">Selecione</option>' +
          accounts
            .filter(
              (a) =>
                a.owner_scope ===
                'business'
            )
            .map(
              (a) =>
                `<option value="${a.id}">
                  ${esc(a.name)}
                  · ${money(a.balance_cents)}
                </option>`
            )
            .join('');
    }

    if ($('pfConcCategory')) {
      $('pfConcCategory')
        .innerHTML =
          '<option value="">Todas</option>' +
          categories
            .filter(
              (c) =>
                Number(c.active) !== 0
            )
            .sort(
              (a,b) =>
                categoryLabel(a)
                  .localeCompare(
                    categoryLabel(b),
                    'pt-BR'
                  )
            )
            .map(
              (c) =>
                `<option value="${c.id}">
                  ${esc(
                    categoryLabel(c)
                  )}
                </option>`
            )
            .join('');
    }
  }

  function categoryLabel(
    category
  ) {
    return category.parent_name
      ? `${category.parent_name} › ${category.name}`
      : category.name;
  }

  function openConciliation() {
    document
      .querySelectorAll('.view')
      .forEach(
        (view) => {
          view.classList.toggle(
            'active',
            view.id ===
              'view-conciliacao'
          );
        }
      );

    document
      .querySelectorAll(
        '[data-view]'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'active',
            button.dataset.view ===
              'conciliacao'
          );
        }
      );

    const title =
      document.querySelector(
        '.topbar-title'
      );

    if (title) {
      title.textContent =
        'Conciliação';
    }

    window.scrollTo({
      top:0,
      behavior:'smooth'
    });

    setTimeout(
      () =>
        $('pfConcSearch')
          ?.focus(),
      80
    );
  }

  function activateTab(name) {
    document
      .querySelectorAll(
        '[data-conc-tab]'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'active',
            button.dataset.concTab ===
              name
          );
        }
      );

    $('pfConcPanelMovimentos')
      .classList.toggle(
        'active',
        name === 'movimentos'
      );

    $('pfConcPanelBancaria')
      .classList.toggle(
        'active',
        name === 'bancaria'
      );

    $('pfConcPanelAuditoria')
      .classList.toggle(
        'active',
        name === 'auditoria'
      );
  }

  async function searchTransactions(
    options = {}
  ) {
    const exactIdMatch =
      String(
        $('pfConcSearch').value ||
        ''
      )
        .trim()
        .match(
          /^#?(\d+)$/
        );

    const exactId =
      exactIdMatch
        ? Number(
            exactIdMatch[1]
          )
        : null;

    const params =
      new URLSearchParams({
        limit:String(LIMIT),
        search_scope:'content'
      });

    const accountId =
      $('pfConcAccount').value;

    const direction =
      $('pfConcDirection').value;

    const from =
      $('pfConcFrom').value;

    const to =
      $('pfConcTo').value;

    if (!exactId) {
      if (accountId) {
        params.set(
          'account_id',
          accountId
        );
      }

      if (direction) {
        params.set(
          'direction',
          direction
        );
      }

      if (from) {
        params.set(
          'date_from',
          from
        );
      }

      if (to) {
        params.set(
          'date_to',
          to
        );
      }
    }

    const data =
      await api(
        `/api/transactions?${params.toString()}`
      );

    let rows =
      data.transactions || [];

    const status =
      $('pfConcStatus').value;

    const categoryId =
      Number(
        $('pfConcCategory')
          .value || 0
      );

    const search =
      String(
        $('pfConcSearch').value ||
        ''
      ).trim();

    if (exactId) {
      rows =
        rows.filter(
          (row) =>
            Number(row.id) ===
            exactId
        );
    } else {
      if (
        status === 'active'
      ) {
        rows =
          rows.filter(
            (row) =>
              row.status !==
              'void'
          );
      }

      if (
        status === 'void'
      ) {
        rows =
          rows.filter(
            (row) =>
              row.status ===
              'void'
          );
      }

      if (categoryId) {
        rows =
          rows.filter(
            (row) =>
              Number(
                row.category_id
              ) ===
              categoryId
          );
      }

      if (search) {
        const wanted =
          norm(search);

        const wantedCents =
          parseMoney(search);

        rows =
          rows.filter(
            (row) => {
              const account =
                accountLabel(row);

              const category =
                row.parent_category_name
                  ? `${row.parent_category_name} ${row.category_name || ''}`
                  : row.category_name ||
                    '';

              const haystack =
                norm([
                  `#${row.id}`,
                  row.id,
                  row.description,
                  row.notes,
                  row.supplier_name,
                  row.debt_name,
                  row.obligation_name,
                  account,
                  category,
                  paymentLabel(
                    row.payment_method
                  ),
                  directionLabel(
                    row.direction
                  ),
                  money(
                    row.amount_cents
                  ),
                  centsInput(
                    row.amount_cents
                  )
                ]
                  .filter(Boolean)
                  .join(' '));

              if (
                haystack.includes(
                  wanted
                )
              ) {
                return true;
              }

              return (
                wantedCents > 0 &&
                Number(
                  row.amount_cents
                ) ===
                wantedCents
              );
            }
          );
      }
    }

    if (
      exactId &&
      status === 'void'
    ) {
      rows =
        rows.filter(
          (row) =>
            row.status ===
            'void'
        );
    } else if (
      exactId &&
      status === 'active'
    ) {
      rows =
        rows.filter(
          (row) =>
            row.status !==
            'void'
        );
    }

    rows.sort(
      (a,b) => {
        const dateCompare =
          String(
            b.occurred_at ||
            ''
          ).localeCompare(
            String(
              a.occurred_at ||
              ''
            )
          );

        return (
          dateCompare ||
          Number(b.id) -
          Number(a.id)
        );
      }
    );

    currentRows = rows;

    renderRows(
      rows,
      $('pfConcRows')
    );

    renderSummary(rows);

    if (
      exactId &&
      !rows.length &&
      !options.silent
    ) {
      notify(
        `Não encontrei o lançamento #${exactId}.`
      );
    }
  }

  function accountLabel(row) {
    if (
      row.direction ===
      'transfer'
    ) {
      return (
        `${row.source_account || 'Origem?'} → ` +
        `${row.destination_account || 'Destino?'}`
      );
    }

    if (
      row.direction ===
      'income'
    ) {
      return (
        row.destination_account ||
        'Destino não informado'
      );
    }

    return (
      row.source_account ||
      'Origem não informada'
    );
  }

  function renderRows(
    rows,
    host
  ) {
    if (!host) return;

    if (!rows.length) {
      host.innerHTML =
        '<tr><td colspan="9" class="pf-conc-empty">Nenhum lançamento encontrado.</td></tr>';

      return;
    }

    host.innerHTML =
      rows
        .map(
          (row) => {
            const category =
              row.parent_category_name
                ? `${row.parent_category_name} › ${row.category_name || ''}`
                : row.category_name ||
                  'Sem categoria';

            const sign =
              row.direction ===
                'income'
                ? '+'
                : row.direction ===
                    'expense'
                  ? '-'
                  : '';

            const valueClass =
              row.direction ===
                'income'
                ? 'income'
                : row.direction ===
                    'expense'
                  ? 'expense'
                  : '';

            const statusClass =
              row.status ===
                'void'
                ? 'void'
                : 'active';

            return `
              <tr>
                <td>
                  ${esc(
                    dateBR(
                      row.occurred_at
                    )
                  )}
                  <br>
                  <small>
                    ${esc(
                      timeBR(
                        row.occurred_at
                      )
                    )}
                  </small>
                </td>

                <td>
                  <strong>
                    #${row.id}
                  </strong>
                </td>

                <td class="pf-conc-desc">
                  <strong>
                    ${esc(
                      row.description
                    )}
                  </strong>

                  <small>
                    ${esc(
                      row.notes || ''
                    )}
                  </small>
                </td>

                <td>
                  ${esc(
                    accountLabel(row)
                  )}
                </td>

                <td>
                  ${esc(category)}
                </td>

                <td>
                  ${esc(
                    paymentLabel(
                      row.payment_method
                    )
                  )}
                </td>

                <td>
                  <span
                    class="pf-conc-status ${statusClass}"
                  >
                    ${
                      row.status ===
                      'void'
                        ? 'Cancelado'
                        : 'Ativo'
                    }
                  </span>
                </td>

                <td
                  class="pf-conc-value ${valueClass}"
                >
                  ${sign}${money(
                    row.amount_cents
                  )}
                </td>

                <td>
                  <button
                    type="button"
                    class="pf-conc-btn"
                    data-conc-edit="${row.id}"
                    ${
                      row.status ===
                      'void'
                        ? 'disabled'
                        : ''
                    }
                  >
                    Editar
                  </button>
                </td>
              </tr>
            `;
          }
        )
        .join('');

    host
      .querySelectorAll(
        '[data-conc-edit]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              const row =
                rows.find(
                  (item) =>
                    Number(item.id) ===
                    Number(
                      button.dataset
                        .concEdit
                    )
                );

              if (row) {
                openEditor(row);
              }
            }
          );
        }
      );
  }

  function renderSummary(rows) {
    const income =
      rows
        .filter(
          (row) =>
            row.status !==
              'void' &&
            row.direction ===
              'income'
        )
        .reduce(
          (sum,row) =>
            sum +
            Number(
              row.amount_cents ||
              0
            ),
          0
        );

    const expense =
      rows
        .filter(
          (row) =>
            row.status !==
              'void' &&
            row.direction ===
              'expense'
        )
        .reduce(
          (sum,row) =>
            sum +
            Number(
              row.amount_cents ||
              0
            ),
          0
        );

    $('pfConcCount')
      .textContent =
        String(
          rows.length
        );

    $('pfConcIncome')
      .textContent =
        money(income);

    $('pfConcExpense')
      .textContent =
        money(expense);

    $('pfConcNet')
      .textContent =
        money(
          income -
          expense
        );
  }

  function clearSearch() {
    const today =
      localYmd();

    $('pfConcSearch').value =
      '';

    $('pfConcAccount').value =
      '';

    $('pfConcDirection').value =
      '';

    $('pfConcCategory').value =
      '';

    $('pfConcStatus').value =
      'active';

    $('pfConcFrom').value =
      monthStart(today);

    $('pfConcTo').value =
      today;

    currentRows = [];

    renderRows(
      [],
      $('pfConcRows')
    );

    renderSummary([]);
  }

  function renderEditSelectors() {
    if (!editing) return;

    const direction =
      $('pfEditDirection').value;

    let nature =
      $('pfEditNature').value;

    if (
      direction ===
      'income'
    ) {
      nature =
        'income';

      $('pfEditNature').value =
        'income';
    }

    if (
      direction ===
      'transfer'
    ) {
      nature =
        'transfer';

      $('pfEditNature').value =
        'transfer';
    }

    $('pfEditNature').disabled =
      direction !==
      'expense';

    const categoryOptions =
      categories
        .filter(
          (category) =>
            category.nature ===
              nature &&
            (
              Number(
                category.active
              ) !== 0 ||
              Number(
                category.id
              ) ===
                Number(
                  editing.category_id
                )
            )
        )
        .sort(
          (a,b) =>
            categoryLabel(a)
              .localeCompare(
                categoryLabel(b),
                'pt-BR'
              )
        );

    $('pfEditCategory')
      .innerHTML =
        '<option value="">Sem categoria</option>' +
        categoryOptions
          .map(
            (category) =>
              `<option value="${category.id}">
                ${esc(
                  categoryLabel(
                    category
                  )
                )}
              </option>`
          )
          .join('');

    const obligationOptions =
      obligations.filter(
        (obligation) =>
          obligation.nature ===
            nature &&
          (
            Number(
              obligation.active
            ) !== 0 ||
            Number(
              obligation.id
            ) ===
              Number(
                editing.obligation_id
              )
          )
      );

    $('pfEditObligation')
      .innerHTML =
        '<option value="">Nenhum / não se aplica</option>' +
        obligationOptions
          .map(
            (obligation) =>
              `<option value="${obligation.id}">
                ${esc(
                  obligation.name
                )}
              </option>`
          )
          .join('');

    const scope =
      nature ===
        'personal_withdrawal'
        ? 'personal'
        : 'business';

    const debtOptions =
      debts.filter(
        (debt) =>
          debt.scope ===
            scope &&
          (
            debt.status ===
              'active' ||
            Number(
              debt.id
            ) ===
              Number(
                editing.debt_id
              )
          )
      );

    $('pfEditDebt')
      .innerHTML =
        '<option value="">Nenhuma / não se aplica</option>' +
        debtOptions
          .map(
            (debt) =>
              `<option value="${debt.id}">
                ${esc(debt.name)}
              </option>`
          )
          .join('');

    const accountOptions =
      accounts
        .map(
          (account) =>
            `<option value="${account.id}">
              ${esc(account.name)}
              · ${money(
                account.balance_cents
              )}
            </option>`
        )
        .join('');

    $('pfEditSource')
      .innerHTML =
        accountOptions;

    $('pfEditDestination')
      .innerHTML =
        accountOptions;

    $('pfEditSourceWrap').hidden =
      direction ===
      'income';

    $('pfEditDestinationWrap').hidden =
      direction ===
      'expense';

    $('pfEditObligationWrap').hidden =
      direction !==
        'expense' ||
      ![
        'business_operating',
        'inventory',
        'business_debt',
        'personal_withdrawal'
      ].includes(nature);

    $('pfEditDebtWrap').hidden =
      direction !==
        'expense' ||
      ![
        'business_debt',
        'personal_withdrawal'
      ].includes(nature);

    setSelect(
      'pfEditCategory',
      editing.category_id
    );

    setSelect(
      'pfEditObligation',
      editing.obligation_id
    );

    setSelect(
      'pfEditDebt',
      editing.debt_id
    );

    setSelect(
      'pfEditSource',
      editing.source_account_id
    );

    setSelect(
      'pfEditDestination',
      editing.destination_account_id
    );

    refreshEditWarning();
  }

  function setSelect(
    id,
    value
  ) {
    if (
      value == null
    ) {
      return;
    }

    const select =
      $(id);

    if (!select) return;

    const exists =
      [...select.options]
        .some(
          (option) =>
            Number(
              option.value
            ) ===
            Number(value)
        );

    if (exists) {
      select.value =
        String(value);
    }
  }

  function openEditor(row) {
    editing =
      {...row};

    $('pfConcEditorTitle')
      .textContent =
        `Editar lançamento #${row.id}`;

    $('pfEditDate').value =
      String(
        row.occurred_at ||
        ''
      ).slice(0,10);

    $('pfEditAmount').value =
      centsInput(
        row.amount_cents
      );

    $('pfEditDescription').value =
      row.description ||
      '';

    $('pfEditDirection').value =
      row.direction ||
      'expense';

    $('pfEditNature').value =
      row.nature ||
      'business_operating';

    $('pfEditMethod').value =
      row.payment_method ||
      'other';

    $('pfEditNotes').value =
      row.notes ||
      '';

    renderEditSelectors();

    $('pfConcEditorDialog')
      .showModal();
  }

  function selectedAccountName(id) {
    const select =
      $(id);

    return String(
      select
        ?.selectedOptions?.[0]
        ?.textContent ||
      ''
    )
      .split(' · ')[0]
      .trim();
  }

  function refreshEditWarning() {
    if (!editing) return;

    const suspicious =
      $('pfEditDirection').value ===
        'expense' &&
      $('pfEditMethod').value ===
        'credit' &&
      norm(
        selectedAccountName(
          'pfEditSource'
        )
      )
        .includes(
          'mercado pago'
        );

    $('pfConcEditorWarning').hidden =
      !suspicious;

    $('pfConcEditorWarning')
      .innerHTML =
        suspicious
          ? `
            <b>
              Inconsistência:
            </b>
            esta saída está como Crédito
            e vinculada à conta Mercado Pago.
            Compra feita no cartão deve ficar
            na fatura e não reduzir o saldo
            bancário no momento da compra.
          `
          : '';
  }

  async function saveEdit(event) {
    event.preventDefault();

    if (!editing) return;

    const direction =
      $('pfEditDirection').value;

    const nature =
      $('pfEditNature').value;

    const date =
      $('pfEditDate').value;

    if (!date) {
      notify(
        'Informe a data.'
      );
      return;
    }

    const suspicious =
      direction ===
        'expense' &&
      $('pfEditMethod').value ===
        'credit' &&
      norm(
        selectedAccountName(
          'pfEditSource'
        )
      )
        .includes(
          'mercado pago'
        );

    if (suspicious) {
      notify(
        'Bloqueado: compra no cartão Mercado Pago não deve reduzir a conta bancária Mercado Pago.'
      );
      return;
    }

    const payload = {
      occurred_at:
        `${date}T16:00:00.000Z`,

      direction,

      amount_cents:
        parseMoney(
          $('pfEditAmount').value
        ),

      description:
        $('pfEditDescription')
          .value
          .trim(),

      nature,

      category_id:
        positiveIntOrNull(
          $('pfEditCategory').value
        ),

      obligation_id:
        direction === 'expense'
          ? positiveIntOrNull(
              $('pfEditObligation')
                .value
            )
          : null,

      debt_id:
        direction === 'expense'
          ? positiveIntOrNull(
              $('pfEditDebt')
                .value
            )
          : null,

      source_account_id:
        direction !== 'income'
          ? positiveIntOrNull(
              $('pfEditSource')
                .value
            )
          : null,

      destination_account_id:
        direction !== 'expense'
          ? positiveIntOrNull(
              $('pfEditDestination')
                .value
            )
          : null,

      payment_method:
        $('pfEditMethod').value,

      notes:
        $('pfEditNotes')
          .value
          .trim() ||
        null
    };

    try {
      await api(
        `/api/transactions/${editing.id}`,
        {
          method:'PATCH',
          body:
            JSON.stringify(
              payload
            )
        }
      );

      $('pfConcEditorDialog')
        .close();

      notify(
        'Lançamento corrigido. Recarregando os saldos.'
      );

      setTimeout(
        () =>
          location.reload(),
        450
      );

    } catch(error) {
      notify(
        error.message
      );
    }
  }

  function positiveIntOrNull(
    value
  ) {
    const number =
      Number(value);

    return (
      Number.isInteger(number) &&
      number > 0
    )
      ? number
      : null;
  }

  async function cancelTransaction() {
    if (!editing) return;

    if (
      !confirm(
        `Cancelar o lançamento #${editing.id}?\n\n` +
        `${editing.description} · ${money(editing.amount_cents)}\n\n` +
        'Ele deixará de afetar saldos e relatórios, mas ficará preservado na auditoria.'
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/transactions/${editing.id}`,
        {
          method:'DELETE'
        }
      );

      $('pfConcEditorDialog')
        .close();

      notify(
        'Lançamento cancelado. Recarregando os saldos.'
      );

      setTimeout(
        () =>
          location.reload(),
        450
      );

    } catch(error) {
      notify(
        error.message
      );
    }
  }

  function updateBankPreview() {
    const account =
      accounts.find(
        (item) =>
          Number(item.id) ===
          Number(
            $('pfBankAccount')
              .value
          )
      );

    const actual =
      parseMoney(
        $('pfBankActual')
          .value
      );

    $('pfBankAppBalance')
      .textContent =
        money(
          account?.balance_cents ||
          0
        );

    if (
      !account ||
      !$('pfBankActual')
        .value
        .trim()
    ) {
      $('pfBankDiffText')
        .textContent =
          'Informe o saldo real para calcular a diferença.';

      return;
    }

    const diff =
      actual -
      Number(
        account.balance_cents ||
        0
      );

    $('pfBankDiffText')
      .textContent =
        `Diferença: ${diff >= 0 ? '+' : ''}${money(diff)} · ` +
        (
          diff === 0
            ? 'saldo já conciliado'
            : 'revise os movimentos antes de ajustar'
        );
  }

  function analyzeBankMovements() {
    const accountId =
      $('pfBankAccount').value;

    if (!accountId) {
      notify(
        'Selecione a conta.'
      );
      return;
    }

    activateTab(
      'movimentos'
    );

    $('pfConcAccount').value =
      accountId;

    $('pfConcSearch').value =
      '';

    $('pfConcStatus').value =
      'active';

    searchTransactions();
  }

  async function reconcileBank() {
    const account =
      accounts.find(
        (item) =>
          Number(item.id) ===
          Number(
            $('pfBankAccount')
              .value
          )
      );

    if (!account) {
      notify(
        'Selecione a conta.'
      );
      return;
    }

    if (
      !$('pfBankActual')
        .value
        .trim()
    ) {
      notify(
        'Informe o saldo real.'
      );
      return;
    }

    const actual =
      parseMoney(
        $('pfBankActual')
          .value
      );

    const diff =
      actual -
      Number(
        account.balance_cents ||
        0
      );

    if (diff === 0) {
      notify(
        'O saldo já está conciliado.'
      );
      return;
    }

    const reason =
      $('pfBankReason')
        .value
        .trim() ||
      'Conciliação com extrato bancário';

    if (
      !confirm(
        `Registrar conciliação de ${account.name}?\n\n` +
        `Saldo no Financeiro: ${money(account.balance_cents)}\n` +
        `Saldo real: ${money(actual)}\n` +
        `Diferença: ${diff >= 0 ? '+' : ''}${money(diff)}\n\n` +
        'Use somente depois de conferir os movimentos.'
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/accounts/${account.id}/reconcile`,
        {
          method:'POST',
          body:
            JSON.stringify({
              new_balance_cents:
                actual,
              reason
            })
        }
      );

      notify(
        'Saldo conciliado com registro de auditoria.'
      );

      setTimeout(
        () =>
          location.reload(),
        450
      );

    } catch(error) {
      notify(
        error.message
      );
    }
  }

  async function loadAudit() {
    try {
      const data =
        await api(
          `/api/transactions?limit=${LIMIT}&search_scope=content`
        );

      const rows =
        (data.transactions || [])
          .filter(
            (row) =>
              row.status ===
              'void'
          )
          .sort(
            (a,b) =>
              String(
                b.occurred_at ||
                ''
              )
                .localeCompare(
                  String(
                    a.occurred_at ||
                    ''
                  )
                )
          );

      renderRows(
        rows,
        $('pfAuditRows')
      );

    } catch(error) {
      notify(
        error.message
      );
    }
  }

  function downloadCsv() {
    if (
      !currentRows.length
    ) {
      notify(
        'Pesquise os lançamentos antes de exportar.'
      );
      return;
    }

    const header = [
      'Data',
      'ID',
      'Descrição',
      'Tipo',
      'Conta',
      'Categoria',
      'Forma',
      'Status',
      'Valor'
    ];

    const lines =
      currentRows.map(
        (row) => {
          const category =
            row.parent_category_name
              ? `${row.parent_category_name} > ${row.category_name || ''}`
              : row.category_name ||
                '';

          const values = [
            dateBR(
              row.occurred_at
            ),
            row.id,
            row.description ||
              '',
            directionLabel(
              row.direction
            ),
            accountLabel(row),
            category,
            paymentLabel(
              row.payment_method
            ),
            row.status ===
              'void'
              ? 'Cancelado'
              : 'Ativo',
            (
              Number(
                row.amount_cents ||
                0
              ) / 100
            )
              .toFixed(2)
              .replace(
                '.',
                ','
              )
          ];

          return values
            .map(csvCell)
            .join(';');
        }
      );

    const csv =
      '\uFEFF' +
      [
        header
          .map(csvCell)
          .join(';'),
        ...lines
      ]
        .join('\r\n');

    const blob =
      new Blob(
        [csv],
        {
          type:'text/csv;charset=utf-8'
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        'a'
      );

    anchor.href = url;

    anchor.download =
      `pantaneira-conciliacao-${localYmd()}.csv`;

    anchor.click();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1000
    );
  }

  function csvCell(value) {
    return (
      `"${String(value ?? '')
        .replace(
          /"/g,
          '""'
        )}"`
    );
  }

  function bindEvents() {
    document
      .querySelectorAll(
        '[data-conc-tab]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () =>
              activateTab(
                button.dataset
                  .concTab
              )
          );
        }
      );

    $('pfConcSearchBtn')
      .addEventListener(
        'click',
        () =>
          searchTransactions()
      );

    $('pfConcClear')
      .addEventListener(
        'click',
        clearSearch
      );

    $('pfConcCsv')
      .addEventListener(
        'click',
        downloadCsv
      );

    $('pfConcPrint')
      .addEventListener(
        'click',
        () =>
          window.print()
      );

    $('pfConcSearch')
      .addEventListener(
        'keydown',
        (event) => {
          if (
            event.key ===
            'Enter'
          ) {
            event.preventDefault();
            searchTransactions();
          }
        }
      );

    $('pfBankAccount')
      .addEventListener(
        'change',
        updateBankPreview
      );

    $('pfBankActual')
      .addEventListener(
        'input',
        updateBankPreview
      );

    $('pfBankAnalyze')
      .addEventListener(
        'click',
        analyzeBankMovements
      );

    $('pfBankReconcile')
      .addEventListener(
        'click',
        reconcileBank
      );

    $('pfAuditLoad')
      .addEventListener(
        'click',
        loadAudit
      );
  }

  async function start() {
    try {
      applyVersion();
      injectStyles();
      injectPage();
      buildEditor();
      injectNavigation();
      bindEvents();
      await loadCatalogs();
    } catch(error) {
      console.error(
        'Conciliação Pantaneira',
        error
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
