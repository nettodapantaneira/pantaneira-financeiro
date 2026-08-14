(() => {
  'use strict';
  const V='1.8.2';
  function setVersion(){
    const foot=document.querySelector('.sidebar-foot strong');
    if(foot) foot.textContent='v'+V;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setVersion);else setVersion();
})();