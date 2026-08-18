(() => {
  'use strict';

  const VERSION = '1.9.4';

  function applyVersion() {
    const footer = document.querySelector('.sidebar-foot strong');

    if (footer && footer.textContent !== `v${VERSION}`) {
      footer.textContent = `v${VERSION}`;
    }

    document.documentElement.dataset.appVersion = VERSION;
    window.PANTANEIRA_FINANCEIRO_VERSION = VERSION;
  }

  function addOperationalNote() {
    const reportView = document.querySelector('#view-pro-reports');
    if (!reportView || document.querySelector('#v194ReportNote')) return;

    const heading = reportView.querySelector('.pr-heading');
    if (!heading) return;

    const note = document.createElement('div');
    note.id = 'v194ReportNote';
    note.style.cssText =
      'margin-top:8px;padding:9px 11px;border:1px solid #dfe5ee;' +
      'border-radius:12px;background:#f8faff;color:#667085;font-size:10px;line-height:1.4';

    note.textContent =
      'Conciliação: vendas brutas de crédito/débito não devem ser tratadas ' +
      'como saldo bancário do Mercado Pago. No banco entra somente a liberação líquida.';

    heading.insertAdjacentElement('afterend', note);
  }

  function start() {
    applyVersion();

    /*
     * A tela Relatórios da v1.9.0 já possui:
     * - Imprimir / PDF
     * - Exportar CSV
     * Portanto não duplicamos botões.
     */
    setTimeout(addOperationalNote, 400);
    setTimeout(addOperationalNote, 1200);

    const observer = new MutationObserver(() => {
      applyVersion();
      addOperationalNote();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
