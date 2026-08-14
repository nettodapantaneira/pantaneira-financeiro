(() => {
  'use strict';
  const VERSION = '1.8.3';

  function applyVersion() {
    const foot = document.querySelector('.sidebar-foot strong');
    if (foot) foot.textContent = 'v' + VERSION;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion);
  } else {
    applyVersion();
  }
})();