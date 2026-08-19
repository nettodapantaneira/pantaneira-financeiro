import worker194 from './worker-v194.js';

const VERSION = '1.9.6';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      const response =
        await worker194.fetch(
          request,
          env,
          ctx
        );

      if (
        url.pathname === '/api/health' &&
        response.ok
      ) {
        const data =
          await response
            .clone()
            .json()
            .catch(() => ({}));

        return json(
          {
            ...data,
            version: VERSION
          },
          response.status
        );
      }

      const type =
        response.headers.get(
          'content-type'
        ) || '';

      if (
        response.ok &&
        type.includes('text/html')
      ) {
        let html =
          await response.text();

        /*
         * A base estável é a v1.9.4.
         * Garante o carregamento do módulo
         * operacional / Conciliação.
         */
        if (
          !html.includes('/v194.js')
        ) {
          html =
            html.replace(
              '</body>',
              `<script src="/v194.js?v=${VERSION}"></script></body>`
            );
        }

        if (
          !html.includes(
            'data-pf-v196-stable'
          )
        ) {
          html =
            html.replace(
              '</body>',
              `${stableBootstrap()}</body>`
            );
        }

        const headers =
          new Headers(
            response.headers
          );

        headers.delete(
          'content-length'
        );

        headers.set(
          'cache-control',
          'no-cache, no-store, must-revalidate'
        );

        headers.set(
          'pragma',
          'no-cache'
        );

        headers.set(
          'expires',
          '0'
        );

        return new Response(
          html,
          {
            status:
              response.status,

            headers
          }
        );
      }

      /*
       * Evita carregar v194.js
       * antigo do cache.
       */
      if (
        url.pathname === '/v194.js' &&
        response.ok
      ) {
        const headers =
          new Headers(
            response.headers
          );

        headers.delete(
          'content-length'
        );

        headers.set(
          'cache-control',
          'no-cache, no-store, must-revalidate'
        );

        return new Response(
          await response.arrayBuffer(),
          {
            status:
              response.status,

            headers
          }
        );
      }

      return response;

    } catch (error) {
      console.error(
        'Pantaneira Financeiro v1.9.6',
        error
      );

      if (
        url.pathname.startsWith(
          '/api/'
        )
      ) {
        return json(
          {
            error:
              String(
                error?.message ||
                error
              )
          },
          400
        );
      }

      /*
       * Se a camada v1.9.6 falhar,
       * permanece na base v1.9.4.
       * Não volta diretamente
       * para v1.9.2.
       */
      return worker194.fetch(
        request,
        env,
        ctx
      );
    }
  }
};

function stableBootstrap() {
  return `
<script data-pf-v196-stable>
(() => {
  'use strict';

  const VERSION = '${VERSION}';

  function applyVersion() {
    const footer =
      document.querySelector(
        '.sidebar-foot strong'
      );

    if (
      footer &&
      footer.textContent !==
        'v' + VERSION
    ) {
      footer.textContent =
        'v' + VERSION;
    }

    document.documentElement
      .dataset
      .appVersion =
        VERSION;

    window
      .PANTANEIRA_FINANCEIRO_VERSION =
        VERSION;
  }

  function ensureV194() {
    if (
      document.querySelector(
        'script[src^="/v194.js"]'
      )
    ) {
      return;
    }

    const script =
      document.createElement(
        'script'
      );

    script.src =
      '/v194.js?v=' +
      encodeURIComponent(
        VERSION
      );

    script.async =
      false;

    document.body
      .appendChild(
        script
      );
  }

  function start() {
    ensureV194();
    applyVersion();

    setTimeout(
      applyVersion,
      100
    );

    setTimeout(
      applyVersion,
      500
    );

    setTimeout(
      applyVersion,
      1500
    );

    /*
     * Observa somente o rodapé.
     * Não observa document.body,
     * evitando loop e travamento.
     */
    const footer =
      document.querySelector(
        '.sidebar-foot'
      );

    if (footer) {
      const observer =
        new MutationObserver(
          () => {
            applyVersion();
          }
        );

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

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }
})();
</script>`;
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store'
      }
    }
  );
}
