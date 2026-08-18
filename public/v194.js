(() => {
  'use strict';

  const VERSION = '1.9.4';

  function applyVersion() {
    const footer =
      document.querySelector('.sidebar-foot strong');

    if (
      footer &&
      footer.textContent !== `v${VERSION}`
    ) {
      footer.textContent =
        `v${VERSION}`;
    }

    document.documentElement.dataset.appVersion =
      VERSION;

    window.PANTANEIRA_FINANCEIRO_VERSION =
      VERSION;
  }

  function start() {
    applyVersion();

    setTimeout(applyVersion, 0);
    setTimeout(applyVersion, 250);
    setTimeout(applyVersion, 1000);

    const footer =
      document.querySelector('.sidebar-foot');

    if (footer) {
      const observer =
        new MutationObserver(applyVersion);

      observer.observe(
        footer,
        {
          childList: true,
          subtree: true,
          characterData: true
        }
      );
    }
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
