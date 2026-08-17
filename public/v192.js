(() => {
  'use strict';

  const VERSION = '1.9.2';

  function applyVersion() {
    const footer = document.querySelector('.sidebar-foot strong');
    if (footer) footer.textContent = 'v' + VERSION;

    document.documentElement.dataset.appVersion = VERSION;
    window.PANTANEIRA_FINANCEIRO_VERSION = VERSION;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion);
  } else {
    applyVersion();
  }
})();
