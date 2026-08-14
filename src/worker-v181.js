import worker180 from './worker-v180.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const res = await worker180.fetch(request, env, ctx);

    if (url.pathname === '/api/health' && res.ok) {
      const data = await res.clone().json().catch(() => ({}));
      return new Response(JSON.stringify({ ...data, version: '1.8.1' }), {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), 'content-type': 'application/json; charset=utf-8' }
      });
    }

    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) {
      let html = await res.text();
      if (!html.includes('/v181.js')) {
        html = html.replace('</body>', '<script src="/v181.js?v=1.8.1"></script></body>');
      }
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.set('cache-control', 'no-cache');
      return new Response(html, { status: res.status, headers });
    }
    return res;
  }
};
