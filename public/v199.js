(() => {
  'use strict';

  const VERSION = '1.9.9';
  const TZ = 'America/Cuiaba';

  function localYmd() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const map = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );

    return `${map.year}-${map.month}-${map.day}`;
  }

  function ensureTransactionDate() {
    const form = document.getElementById('transactionForm');
    const amount = document.getElementById('amount');
    if (!form || !amount) return;

    let input = document.getElementById('transactionDate');

    if (!input) {
      const label = document.createElement('label');
      label.textContent = 'Data';
      input = document.createElement('input');
      input.id = 'transactionDate';
      input.type = 'date';
      input.required = true;

      amount.previousElementSibling?.insertAdjacentElement('beforebegin', label);
      amount.previousElementSibling?.insertAdjacentElement('beforebegin', input);
    }

    if (!input.value) input.value = localYmd();
  }

  function applyVersion() {
    const footer = document.querySelector('.sidebar-foot strong');
    if (footer) footer.textContent = `v${VERSION}`;
    document.documentElement.dataset.appVersion = VERSION;
    window.PANTANEIRA_FINANCEIRO_VERSION = VERSION;
  }

  function boot() {
    ensureTransactionDate();
    applyVersion();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
