import worker181 from './worker-v181.js';

const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
      const body = await request.clone().json().catch(() => null);
      if (body && parseCardPurchaseCommand(body.text)) {
        return handleCardPurchaseCommand(body, request, env);
      }
    }

    const res = await worker181.fetch(request, env, ctx);

    if (url.pathname === '/api/health' && res.ok) {
      const data = await res.clone().json().catch(() => ({}));
      return new Response(JSON.stringify({ ...data, version: '1.8.2' }), {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), 'content-type': 'application/json; charset=utf-8' }
      });
    }

    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) {
      let html = await res.text();
      if (!html.includes('/v182.js')) {
        html = html.replace('</body>', '<script src="/v182.js?v=1.8.2"></script></body>');
      }
      const headers = new Headers(res.headers);
      headers.delete('content-length');
      headers.set('cache-control', 'no-cache');
      return new Response(html, { status: res.status, headers });
    }
    return res;
  }
};

async function handleCardPurchaseCommand(body, request, env) {
  const secret = String(request.headers.get('x-finance-bot-secret') || '');
  if (!secret || !env.FINANCE_BOT_SECRET || secret !== String(env.FINANCE_BOT_SECRET)) {
    return json({ error: 'Não autorizado.' }, 401);
  }
  if (!samePhone(body.from, env.WHATSAPP_ALLOWED_NUMBER)) {
    return json({ error: 'Número não autorizado.' }, 403);
  }

  const parsed = parseCardPurchaseCommand(body.text);
  if (!parsed) return json({ error: 'Comando de compra no cartão inválido.' }, 400);

  const db = env.DB;

  const card = await db.prepare(`
    SELECT *
    FROM credit_cards
    WHERE active=1
      AND (
        lower(trim(name)) LIKE '%mercado pago%'
        OR lower(trim(COALESCE(issuer,'')))='mercado pago'
      )
    ORDER BY id
    LIMIT 1
  `).first();

  if (!card) {
    return json({ error: 'Cartão Mercado Pago não cadastrado em Compromissos → Cartões e faturas.' }, 400);
  }
  if (!card.closing_day || !card.due_day) {
    return json({ error: 'Informe fechamento e vencimento do Cartão Mercado Pago antes de lançar pelo WhatsApp.' }, 400);
  }

  const billInfo = billForPurchase(parsed.purchase_date, Number(card.closing_day), Number(card.due_day));

  let bill = await db.prepare(`
    SELECT *
    FROM credit_card_bills
    WHERE card_id=? AND period_key=? AND status!='void'
    LIMIT 1
  `).bind(card.id, billInfo.period_key).first();

  if (!bill) {
    const billCat = await ensureCategory(db, 'Pagamento de fatura de cartão', 'business_debt');
    const obligation = await db.prepare(`
      INSERT INTO obligations(
        name,scope,nature,category_id,monthly_target_cents,due_day,due_date,
        recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,
        active,notes
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)
    `).bind(
      `Fatura ${card.name} · ${periodLabel(billInfo.period_key)}`,
      'business',
      'business_debt',
      billCat.id,
      parsed.amount_cents,
      Number(card.due_day),
      billInfo.due_date,
      0,0,1,1,0,
      `[CARD_BILL] ${billInfo.period_key} [AUTO_WHATSAPP]`
    ).run();

    const created = await db.prepare(`
      INSERT INTO credit_card_bills(
        card_id,period_key,total_cents,due_date,closing_date,obligation_id,status,notes
      )
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      card.id,
      billInfo.period_key,
      parsed.amount_cents,
      billInfo.due_date,
      billInfo.closing_date,
      obligation.meta.last_row_id,
      'open',
      '[AUTO_WHATSAPP] Fatura criada automaticamente a partir de compras lançadas pelo WhatsApp.'
    ).run();

    bill = await db.prepare('SELECT * FROM credit_card_bills WHERE id=?')
      .bind(created.meta.last_row_id).first();
  } else {
    const detailed = Number((await db.prepare(`
      SELECT COALESCE(SUM(amount_cents),0) total
      FROM credit_card_items
      WHERE bill_id=? AND status='posted'
    `).bind(bill.id).first())?.total || 0);

    const hasUndetailed = Number(bill.total_cents) > detailed;
    const autoTracked = String(bill.notes || '').includes('[AUTO_WHATSAPP]');

    if (autoTracked || !hasUndetailed) {
      await db.prepare(`
        UPDATE credit_card_bills
        SET total_cents=total_cents+?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(parsed.amount_cents, bill.id).run();
      bill.total_cents = Number(bill.total_cents) + parsed.amount_cents;
    }
  }

  const category = await resolveCategory(db, parsed);

  const item = await db.prepare(`
    INSERT INTO credit_card_items(
      bill_id,purchase_date,description,amount_cents,scope,nature,category_id,
      installment_number,installment_total,notes,status
    )
    VALUES(?,?,?,?,?,?,?,?,?,?,'posted')
  `).bind(
    bill.id,
    parsed.purchase_date,
    parsed.description,
    parsed.amount_cents,
    parsed.scope,
    parsed.nature,
    category?.id || null,
    null,
    null,
    'Lançado pelo WhatsApp. Não movimenta o saldo bancário até o pagamento da fatura.'
  ).run();

  await db.prepare(`
    INSERT INTO credit_card_revisions(entity_type,entity_id,action,before_json,after_json)
    VALUES('item',?,'create',NULL,?)
  `).bind(
    item.meta.last_row_id,
    JSON.stringify({
      bill_id: bill.id,
      purchase_date: parsed.purchase_date,
      description: parsed.description,
      amount_cents: parsed.amount_cents,
      scope: parsed.scope,
      nature: parsed.nature,
      category_id: category?.id || null
    })
  ).run();

  const updatedBill = await db.prepare('SELECT * FROM credit_card_bills WHERE id=?').bind(bill.id).first();
  const paid = Number((await db.prepare(`
    SELECT COALESCE(SUM(amount_cents),0) total
    FROM credit_card_payments
    WHERE bill_id=? AND status='posted'
  `).bind(bill.id).first())?.total || 0);

  const remaining = Math.max(0, Number(updatedBill.total_cents) - paid);
  let status = remaining === 0 ? 'paid' : paid > 0 ? 'partial' : 'open';
  if (remaining > 0 && String(updatedBill.due_date) < localDate()) status = 'overdue';

  await db.prepare(`
    UPDATE credit_card_bills
    SET status=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(status, bill.id).run();

  if (updatedBill.obligation_id) {
    await db.prepare(`
      UPDATE obligations
      SET monthly_target_cents=?, due_day=?, due_date=?, active=?,
          notes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      remaining,
      Number(card.due_day),
      updatedBill.due_date,
      remaining > 0 ? 1 : 0,
      `[CARD_BILL:${bill.id}] saldo restante da fatura`,
      updatedBill.obligation_id
    ).run();
  }

  const scopeText = parsed.scope === 'personal' ? 'Pessoal' : 'Empresa';
  const catText = category?.name ? ` · ${category.name}` : '';
  const reply =
    `Compra no cartão registrada: ${brl(parsed.amount_cents)} · ${parsed.description}` +
    ` · ${scopeText}${catText}\n` +
    `Fatura: ${periodLabel(billInfo.period_key)} · vence ${formatDateBR(billInfo.due_date)}\n` +
    `Saldo bancário não foi alterado agora.`;

  return json({ ok: true, item_id: item.meta.last_row_id, bill_id: bill.id, reply });
}

function parseCardPurchaseCommand(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  let purchaseDate = localDate();

  const datePrefix = raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/);
  if (datePrefix) {
    const day = Number(datePrefix[1]);
    const month = Number(datePrefix[2]);
    let year = datePrefix[3] ? Number(datePrefix[3]) : Number(localDate().slice(0,4));
    if (year < 100) year += 2000;
    purchaseDate = safeDate(year, month, day);
    if (!purchaseDate) return null;
    raw = raw.slice(datePrefix[0].length).trim();
  }

  if (!/^(?:compra|comprei|gasto|gastei)\b/i.test(raw)) return null;

  const afterVerb = raw.replace(/^(?:compra|comprei|gasto|gastei)\s+/i, '');
  const amountMatch = afterVerb.match(/^((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?)\s+/);
  if (!amountMatch) return null;

  const amountCents = parseBRMoney(amountMatch[1]);
  if (amountCents <= 0) return null;

  let rest = afterVerb.slice(amountMatch[0].length).trim();
  const normalized = norm(rest);

  if (!/(?:credito|cartao(?: de credito)?)\s+(?:do\s+)?mercado pago\b/.test(normalized) &&
      !/\bmercado pago\s+(?:credito|cartao)\b/.test(normalized)) {
    return null;
  }

  let scope = null;
  if (/\bpessoal\b/.test(normalized)) scope = 'personal';
  if (/\bempresa\b|\bempresarial\b/.test(normalized)) scope = 'business';

  if (!scope && /\b(?:para|minha|da)\s+casa\b|\buso pessoal\b/.test(normalized)) {
    scope = 'personal';
  }
  if (!scope && /\b(?:loja|empresa|estoque|mercadoria|marketing)\b/.test(normalized)) {
    scope = 'business';
  }
  if (!scope) {
    return null;
  }

  let categoryName = null;
  const categoryMatch = rest.match(/\s+categoria\s+(.+)$/i);
  if (categoryMatch) {
    categoryName = categoryMatch[1].trim();
    rest = rest.slice(0, categoryMatch.index).trim();
  }

  rest = rest
    .replace(/\s+(?:no\s+)?(?:credito|crédito|cartao|cartão)(?:\s+de\s+(?:credito|crédito))?\s+(?:do\s+)?mercado\s*pago\b/ig, ' ')
    .replace(/\s+mercado\s*pago\s+(?:credito|crédito|cartao|cartão)\b/ig, ' ')
    .replace(/\s+\b(?:pessoal|empresa|empresarial)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const description = rest || (scope === 'personal' ? 'Compra pessoal no cartão' : 'Compra da empresa no cartão');
  const nature = scope === 'personal' ? 'personal_withdrawal' : inferBusinessNature(description);

  return {
    amount_cents: amountCents,
    description,
    purchase_date: purchaseDate,
    scope,
    nature,
    category_name: categoryName
  };
}

async function resolveCategory(db, parsed) {
  if (parsed.category_name) {
    const found = await db.prepare(`
      SELECT id,name,nature
      FROM categories
      WHERE active=1 AND lower(trim(name))=lower(trim(?))
      LIMIT 1
    `).bind(parsed.category_name).first();
    if (found && found.nature === parsed.nature) return found;
  }

  const n = norm(parsed.description);

  if (parsed.scope === 'personal') {
    if (/\b(planta|plantas|decoracao|vaso|vasos|jardim|casa)\b/.test(n)) {
      return ensureCategory(db, 'Casa e decoração', 'personal_withdrawal');
    }
    if (/\b(mercado|supermercado|atacadista)\b/.test(n)) {
      const c = await findCategoryLike(db, 'Mercado pessoal', 'personal_withdrawal');
      if (c) return c;
    }
    return ensureCategory(db, 'Outros pessoais', 'personal_withdrawal');
  }

  if (parsed.nature === 'inventory') {
    const c = await findCategoryLike(db, 'Compras e estoque', 'inventory');
    if (c) return c;
    return ensureCategory(db, 'Compras e estoque', 'inventory');
  }

  if (/\b(facebook|instagram|meta|trafego|anuncio|publicidade|marketing)\b/.test(n)) {
    const c = await findCategoryLike(db, 'Marketing e publicidade', 'business_operating');
    if (c) return c;
    return ensureCategory(db, 'Marketing e publicidade', 'business_operating');
  }

  return ensureCategory(db, 'Outras despesas da empresa', 'business_operating');
}

function inferBusinessNature(description) {
  const n = norm(description);
  if (/\b(estoque|mercadoria|fornecedor|produto|insumo|materia prima)\b/.test(n)) return 'inventory';
  return 'business_operating';
}

async function findCategoryLike(db, name, nature) {
  return db.prepare(`
    SELECT id,name,nature
    FROM categories
    WHERE active=1 AND nature=? AND lower(trim(name))=lower(trim(?))
    LIMIT 1
  `).bind(nature, name).first();
}

async function ensureCategory(db, name, nature) {
  const existing = await findCategoryLike(db, name, nature);
  if (existing) return existing;
  const r = await db.prepare('INSERT INTO categories(name,nature) VALUES(?,?)').bind(name, nature).run();
  return { id: r.meta.last_row_id, name, nature };
}

function billForPurchase(dateStr, closingDay, dueDay) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let year = y, month = m;
  if (d > closingDay) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  const periodKey = `${year}-${String(month).padStart(2,'0')}`;
  const due = makeDateClamped(year, month, dueDay);
  const closing = makeDateClamped(year, month, closingDay);
  return { period_key: periodKey, due_date: due, closing_date: closing };
}

function makeDateClamped(year, month, day) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), last);
  return `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function safeDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function parseBRMoney(v) {
  let s = String(v).trim().replace(/R\$/gi,'').replace(/\s/g,'');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g,'').replace(',','.');
  else if (s.includes(',')) s = s.replace(',','.');
  else if ((s.match(/\./g)||[]).length > 1) s = s.replace(/\./g,'');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.','');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n*100) : 0;
}

function norm(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

function digits(v) { return String(v || '').replace(/\D/g,''); }

function samePhone(a,b) {
  const aa=digits(a), bb=digits(b);
  if (!aa || !bb) return false;
  if (aa===bb) return true;
  const variants=x=>{
    const out=new Set([x]);
    let y=x.startsWith('55')?x.slice(2):x;
    out.add(y);
    if(y.length===11&&y[2]==='9')out.add(y.slice(0,2)+y.slice(3));
    if(y.length===10)out.add(y.slice(0,2)+'9'+y.slice(2));
    return out;
  };
  const A=variants(aa), B=variants(bb);
  for(const x of A) if(B.has(x)) return true;
  return false;
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
}

function brl(c) {
  return new Intl.NumberFormat('pt-BR',{
    style:'currency',currency:'BRL'
  }).format(Number(c||0)/100);
}

function periodLabel(k) {
  const [y,m]=String(k).split('-');
  const names=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${names[Number(m)]||m}/${y}`;
}

function formatDateBR(v) {
  const [y,m,d]=String(v).split('-');
  return `${d}/${m}/${y}`;
}

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}
