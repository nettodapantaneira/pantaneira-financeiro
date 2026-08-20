const CACHE='pantaneira-financeiro-v1.9.8';
const ASSETS=[
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/v180.js',
  '/v181.js',
  '/v182.js',
  '/v183.js',
  '/v190.js',
  '/v191.js',
  '/v192.js',
  '/v193.js',
  '/v198.js',
  '/premium.css',
  '/mobile-final.css',
  '/manifest.webmanifest'
];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(ASSETS))
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key!==CACHE)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);

  if(req.method!=='GET'||url.pathname.startsWith('/api/'))return;

  event.respondWith(
    fetch(req)
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy));
        return response;
      })
      .catch(()=>
        caches.match(req).then(response=>response||caches.match('/index.html'))
      )
  );
});
