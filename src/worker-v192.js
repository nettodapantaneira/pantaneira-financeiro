import worker191 from './worker-v191.js';

const VERSION = '1.9.2';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const res = await worker191.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, res.status);
      }

      const type = res.headers.get('content-type') || '';

      if (res.ok && type.includes('text/html')) {
        let html = await res.text();

        if (!html.includes('/v192.js')) {
          html = html.replace(
            '</body>',
            `<script src="/v192.js?v=${VERSION}"></script></body>`
          );
        }

        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control', 'no-cache');

        return new Response(html, {
          status: res.status,
          headers
        });
      }

      return res;
    } catch (error) {
      console.error('v1.9.2', error);

      if (url.pathname.startsWith('/api/')) {
        return json(
          { error: String(error?.message || error) },
          400
        );
      }

      return worker191.fetch(request, env, ctx);
    }
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
