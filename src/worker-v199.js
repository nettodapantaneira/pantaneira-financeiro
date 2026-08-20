import worker198 from './worker-v198.js';

const VERSION = '1.9.9';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const res = await worker198.fetch(request, env, ctx);

    if (url.pathname === '/api/health' && res.ok) {
      const data = await res.clone().json().catch(() => ({}));
      return json({ ...data, version: VERSION }, res.status);
    }

    const type = res.headers.get('content-type') || '';

    if (res.ok && type.includes('text/html')) {
      let html = await res.text();

      if (!html.includes('/v199.js')) {
        html = html.replace(
          '</body>',
          `<script src="/v199.js?v=${VERSION}"></script></body>`
        );
      }

      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');

      return new Response(html, {
        status: res.status,
        headers
      });
    }

    return res;
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
