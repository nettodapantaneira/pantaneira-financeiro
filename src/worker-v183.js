import worker182 from './worker-v182.js';

const REPAIR_SETTING = 'v183_whatsapp_blank_creditor_repair_done';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // Reparo idempotente dos lançamentos antigos afetados pelo bug:
      // debt.creditor = NULL -> normalizeText('') -> texto.includes('') === true.
      await repairHistoricalFalseDebtMatches(env.DB);

      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        const body = await request.clone().json().catch(() => null);
        const res = await worker182.fetch(request, env, ctx);

        if (body?.text && res.ok && isExpenseCommand(body.text)) {
          const repaired = await repairJustCreatedCommand(env.DB, res, body.text);
          if (repaired) return repaired;
        }

        return res;
      }

      const res = await worker182.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: '1.8.3' }, res.status);
      }

      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('text/html')) {
        let html = await res.text();
        if (!html.includes('/v183.js')) {
          html = html.replace('</body>', '<script src="/v183.js?v=1.8.3"></script></body>');
        }
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control', 'no-cache');
        return new Response(html, { status: res.status, headers });
      }

      return res;
    } catch (error) {
      console.error('v1.8.3 wrapper error', error);
      // Não derruba o app por causa do reparo auxiliar.
      return worker182.fetch(request, env, ctx);
    }
  }
};

async function repairJustCreatedCommand(db, response, rawText) {
  const data = await response.clone().json().catch(() => null);
  if (!data?.reply) return null;

  const idMatch = String(data.reply).match(/\bID\s*#(\d+)\b/i);
  if (!idMatch) return null;

  const result = await repairTransactionIfFalseDebt(db, Number(idMatch[1]), rawText);
  if (!result?.repaired) return null;

  data.reply = String(data.reply)
    .replace(/Categoria:\s*[^\n]+/i, `Categoria: ${result.category_label}`)
    .replace(/\n?Classificação corrigida automaticamente\.[^\n]*/ig, '');

  data.reply += '\nClassificação corrigida automaticamente.';

  return json(data, response.status);
}

async function repairHistoricalFalseDebtMatches(db) {
  const done = await db.prepare('SELECT value FROM settings WHERE key=? LIMIT 1')
    .bind(REPAIR_SETTING).first().catch(() => null);

  if (done?.value === '1') return;

  const rows = (await db.prepare(`
    SELECT
      t.id,t.amount_cents,t.opening_history,t.description,t.notes,t.nature,t.category_id,
      t.obligation_id,t.debt_id,t.status,
      d.name debt_name,d.creditor debt_creditor
    FROM transactions t
    JOIN debts d ON d.id=t.debt_id
    WHERE t.direction='expense'
      AND t.status!='void'
      AND t.debt_id IS NOT NULL
      AND COALESCE(t.notes,'')='Lançado pelo WhatsApp'
    ORDER BY t.id
  `).all()).results || [];

  let repaired = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await repairExistingRow(db, row);
    if (result?.repaired) repaired++;
    else skipped++;
  }

  const value = JSON.stringify({
    done: true,
    repaired,
    skipped,
    at: new Date().toISOString()
  });

  await db.prepare(`
    INSERT INTO settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).bind(REPAIR_SETTING, '1').run();

  await db.prepare(`
    INSERT INTO settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).bind('v183_whatsapp_blank_creditor_repair_summary', value).run();
}

async function repairExistingRow(db, row) {
  if (!isFalseDebtMatch(row, row.description)) return { repaired: false };

  const category = await inferIntendedCategory(db, row.description);
  if (!category) return { repaired: false };

  return applyRepair(db, row, category);
}

async function repairTransactionIfFalseDebt(db, id, rawText) {
  const row = await db.prepare(`
    SELECT
      t.id,t.amount_cents,t.opening_history,t.description,t.notes,t.nature,t.category_id,
      t.obligation_id,t.debt_id,t.status,
      d.name debt_name,d.creditor debt_creditor
    FROM transactions t
    LEFT JOIN debts d ON d.id=t.debt_id
    WHERE t.id=?
    LIMIT 1
  `).bind(id).first();

  if (!row || !row.debt_id || row.status === 'void') return { repaired: false };
  if (!isFalseDebtMatch(row, rawText)) return { repaired: false };

  const category = await inferIntendedCategory(db, rawText || row.description);
  if (!category) return { repaired: false };

  return applyRepair(db, row, category);
}

function isFalseDebtMatch(row, text) {
  const n = norm(text || row.description || '');
  const desc = norm(row.description || '');
  const debtName = norm(row.debt_name || '');
  const creditor = norm(row.debt_creditor || '');

  // Nunca mexe em comandos claramente relacionados a dívida/acordo.
  if (/\b(acordo|divida|emprestimo|financiamento|parcela|chico)\b/.test(n)) return false;

  // Se o nome real da dívida aparece, o vínculo é intencional.
  if (debtName && (n.includes(debtName) || desc.includes(debtName))) return false;

  // Credor só pode ser considerado se houver texto real; vazio nunca é match.
  if (creditor && (n.includes(creditor) || desc.includes(creditor))) return false;

  // O bug que estamos corrigindo ocorre quando o credor está vazio/nulo.
  return !creditor;
}

async function applyRepair(db, row, category) {
  const before = await db.prepare('SELECT * FROM transactions WHERE id=?').bind(row.id).first();
  if (!before) return { repaired: false };

  let obligationId = before.obligation_id;
  if (obligationId) {
    const obligation = await db.prepare('SELECT nature FROM obligations WHERE id=?')
      .bind(obligationId).first();
    if (!obligation || obligation.nature !== category.nature) obligationId = null;
  }

  if (Number(before.opening_history || 0) === 0 && before.debt_id) {
    await db.prepare(`
      UPDATE debts
      SET
        current_balance_cents=CASE
          WHEN current_balance_cents IS NULL THEN NULL
          ELSE current_balance_cents + ?
        END,
        status=CASE
          WHEN current_balance_cents IS NULL THEN status
          ELSE 'active'
        END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(Number(before.amount_cents), Number(before.debt_id)).run();
  }

  await db.prepare(`
    UPDATE transactions
    SET
      nature=?,
      category_id=?,
      debt_id=NULL,
      obligation_id=?,
      notes=CASE
        WHEN COALESCE(notes,'')='' THEN 'Reparo automático v1.8.3'
        WHEN instr(notes,'Reparo automático v1.8.3')>0 THEN notes
        ELSE notes || ' · Reparo automático v1.8.3'
      END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(category.nature, category.id, obligationId, row.id).run();

  const after = await db.prepare('SELECT * FROM transactions WHERE id=?').bind(row.id).first();

  await db.prepare(`
    INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json)
    VALUES(?,?,?,?)
  `).bind(
    row.id,
    'edit',
    JSON.stringify(before),
    JSON.stringify(after)
  ).run().catch(() => {});

  return {
    repaired: true,
    category_label: category.parent_name ? `${category.parent_name} → ${category.name}` : category.name,
    nature: category.nature
  };
}

async function inferIntendedCategory(db, text) {
  const categories = (await db.prepare(`
    SELECT c.id,c.name,c.nature,c.parent_id,p.name parent_name
    FROM categories c
    LEFT JOIN categories p ON p.id=c.parent_id
    WHERE c.active=1
  `).all()).results || [];

  const clean = cleanCommand(text);

  // 1) Nome completo da categoria escrito no comando: prioridade máxima.
  const exact = categories
    .map(c => ({ c, name: norm(c.name) }))
    .filter(x => x.name && (` ${clean} `).includes(` ${x.name} `))
    .sort((a,b) => b.name.length - a.name.length)[0];
  if (exact) return exact.c;

  // 2) Regras naturais de uso frequente.
  const aliases = [
    [/material de expediente|\bexpediente\b|\bsuporte\b|\btripe\b/, 'Material de expediente'],
    [/facebook|instagram|meta|trafego|anuncio|publicidade|marketing/, 'Marketing e publicidade'],
    [/\bdoacao\b|\bdoacoes\b/, 'Doações'],
    [/\bmarmita\b/, 'Marmita'],
    [/\blanche\b/, 'Lanche'],
    [/mercado pessoal|\bsupermercado\b|\batacadista\b/, 'Mercado pessoal'],
    [/combustivel pessoal|gasolina pessoal/, 'Combustível pessoal'],
    [/combustivel empresa|gasolina loja/, 'Combustível empresa'],
    [/chatgpt|canva|vectorize|\berp\b/, 'Sistemas e aplicativos'],
    [/\bpensao\b/, 'Família e pensão'],
    [/aluguel casa/, 'Moradia'],
    [/aluguel loja/, 'Aluguel e ocupação'],
    [/\bfrete\b|\bentrega\b/, 'Fretes e entregas'],
    [/agua mineral/, 'Água mineral e consumo da loja'],
    [/\blimpeza\b/, 'Produtos de limpeza']
  ];

  for (const [pattern, categoryName] of aliases) {
    if (!pattern.test(clean)) continue;
    const found = categories.find(c => norm(c.name) === norm(categoryName));
    if (found) return found;
  }

  // 3) Correspondência por todos os termos significativos da categoria.
  const textTokens = tokens(clean);
  const scored = categories.map(c => {
    const ct = tokens(c.name);
    if (!ct.length) return { c, score: 0 };
    const all = ct.every(t => textTokens.includes(t));
    return { c, score: all ? (ct.length * 100 + norm(c.name).length) : 0 };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);

  return scored[0]?.c || null;
}

function cleanCommand(value) {
  let s = ` ${norm(value)} `;
  const phrases = [
    'mercado pago','dinheiro fisico','dinheiro','nubank','caixa',
    'pix','debito','credito','boleto','transferencia','transfer',
    'gasto','gastei','paguei','saida','saiu','entrou','recebi','vendi','venda',
    'categoria'
  ];
  for (const p of phrases) s = s.replace(new RegExp(`\\b${escapeRe(p)}\\b`, 'g'), ' ');
  s = s.replace(/\br\s*\$/g,' ').replace(/\b\d+(?:[.,]\d+)?\b/g,' ');
  return s.replace(/\s+/g,' ').trim();
}

function tokens(value) {
  const stop = new Set(['de','da','do','das','dos','e','em','para','por','com','tipo','loja']);
  return norm(value)
    .replace(/[^a-z0-9]+/g,' ')
    .split(' ')
    .filter(Boolean)
    .map(t => t.length > 4 && t.endsWith('s') ? t.slice(0,-1) : t)
    .filter(t => t.length >= 2 && !stop.has(t));
}

function isExpenseCommand(text) {
  const n = norm(String(text || '').replace(/^\s*\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\s+/, ''));
  return /^(gasto|gastei|paguei|saida|saiu)\b/.test(n);
}

function norm(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

function escapeRe(v) {
  return String(v || '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
