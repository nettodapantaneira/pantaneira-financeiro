import worker194 from './worker-v194.js';

const VERSION = '1.9.5';
const TZ = 'America/Cuiaba';
const AUTO_TAG = 'AUTO_V195';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/v195/repair-mercado-pago' && request.method === 'POST') {
        const auth = await requireAppSession(request, env, ctx);
        if (auth) return auth;
        return await handleAutomaticMercadoPagoRepair(request, env);
      }

      if (url.pathname === '/api/transactions' && request.method === 'POST') {
        const handled = await maybeHandleWebCardPurchase(request, env, ctx);
        if (handled) return handled;
      }

      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        const handled = await maybeHandleWhatsAppCardPurchase(request, env);
        if (handled) return handled;
      }

      const res = await worker194.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: VERSION }, res.status);
      }

      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('text/html')) {
        let html = await res.text();

        if (!html.includes('data-pf-v195')) {
          html = html.replace(
            '</body>',
            `${v195EnhancementMarkup()}</body>`
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
      console.error('v1.9.5', error);

      if (url.pathname.startsWith('/api/')) {
        return json({ error: String(error?.message || error) }, 400);
      }

      return worker194.fetch(request, env, ctx);
    }
  }
};

async function requireAppSession(request, env, ctx) {
  const probeUrl = new URL('/api/accounts', request.url);
  const probe = new Request(probeUrl, {
    method: 'GET',
    headers: request.headers
  });

  const res = await worker194.fetch(probe, env, ctx);

  if (res.status === 401) {
    return json({ error: 'Sessão expirada.' }, 401);
  }

  if (!res.ok) {
    return json({ error: 'Não foi possível validar a sessão.' }, res.status);
  }

  return null;
}

async function maybeHandleWebCardPurchase(request, env, ctx) {
  const body = await request.clone().json().catch(() => null);
  if (!body) return null;

  if (String(body.direction || '') !== 'expense') return null;
  if (String(body.payment_method || '') !== 'credit') return null;
  if (!body.source_account_id) return null;

  const description = String(body.description || '').trim();
  if (isSaleFeeOrBillPayment(description)) return null;

  const account = await env.DB.prepare(
    'SELECT id,name FROM accounts WHERE id=? AND active=1'
  ).bind(Number(body.source_account_id)).first();

  if (!account || !isMercadoPagoName(account.name)) return null;

  const auth = await requireAppSession(request, env, ctx);
  if (auth) return auth;

  const result = await createCardItemFromPayload(env.DB, {
    purchase_date: isoDateFromValue(body.occurred_at) || localDate(),
    description,
    amount_cents: positiveInt(body.amount_cents, 'amount_cents'),
    nature: normalizeNature(body.nature),
    category_id: nullablePositiveInt(body.category_id),
    notes: appendNote(
      body.notes,
      `[${AUTO_TAG}] Compra criada pelo formulário sem movimentar a conta bancária.`
    ),
    source_transaction_id: null,
    preferred_account_id: Number(account.id)
  });

  return json({
    ok: true,
    card_purchase: true,
    item_id: result.item_id,
    bill_id: result.bill_id,
    warnings: [],
    reply: 'Compra registrada na fatura do Cartão Mercado Pago. O saldo bancário não foi reduzido agora.'
  }, 201);
}

async function maybeHandleWhatsAppCardPurchase(request, env) {
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body.text !== 'string') return null;

  const parsed = parseWhatsAppCardPurchase(body.text);
  if (!parsed) return null;

  const secret = String(request.headers.get('x-finance-bot-secret') || '');

  if (
    !secret ||
    !env.FINANCE_BOT_SECRET ||
    secret !== String(env.FINANCE_BOT_SECRET)
  ) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  if (!samePhone(body.from, env.WHATSAPP_ALLOWED_NUMBER)) {
    return json({ error: 'Número não autorizado.' }, 403);
  }

  if (!parsed.scope) {
    return json({
      error:
        'Informe se a compra no Cartão Mercado Pago é pessoal ou empresa. Ex.: gasto 52,87 mercado cartão mercado pago pessoal.'
    }, 400);
  }

  const account = await findMercadoPagoAccount(env.DB);

  if (!account) {
    return json({ error: 'Conta Mercado Pago não encontrada.' }, 400);
  }

  const nature =
    parsed.scope === 'personal'
      ? 'personal_withdrawal'
      : inferBusinessNature(parsed.description);

  const result = await createCardItemFromPayload(env.DB, {
    purchase_date: parsed.purchase_date,
    description: parsed.description,
    amount_cents: parsed.amount_cents,
    nature,
    category_id: null,
    notes:
      `[${AUTO_TAG}] Compra lançada pelo WhatsApp. ` +
      `Não movimenta o saldo bancário até o pagamento da fatura.`,
    source_transaction_id: null,
    preferred_account_id: Number(account.id)
  });

  return json({
    ok: true,
    item_id: result.item_id,
    bill_id: result.bill_id,
    reply:
      `Compra no cartão registrada: ${brl(parsed.amount_cents)} · ${parsed.description}\n` +
      `Fatura: ${periodLabel(result.period_key)} · ${
        parsed.scope === 'personal' ? 'Pessoal' : 'Empresa'
      }\n` +
      'Saldo bancário não foi alterado agora.'
  });
}

async function handleAutomaticMercadoPagoRepair(request, env) {
  const body = await request.json().catch(() => ({}));

  const accountId = positiveInt(
    body.account_id,
    'account_id'
  );

  const actualBalance = nonNegativeInt(
    body.actual_balance_cents,
    'actual_balance_cents'
  );

  const account = await env.DB.prepare(
    'SELECT * FROM accounts WHERE id=? AND active=1'
  ).bind(accountId).first();

  if (!account) {
    return json({ error: 'Conta não encontrada.' }, 404);
  }

  if (!isMercadoPagoName(account.name)) {
    return json({
      error:
        'O reparo automático desta versão é exclusivo para a conta Mercado Pago.'
    }, 400);
  }

  const balanceBefore = Number(
    (await accountBalance(env.DB, accountId))?.balance_cents || 0
  );

  const card = await ensureMercadoPagoCard(
    env.DB,
    accountId
  );

  const suspicious = (
    await env.DB.prepare(`
      SELECT
        t.*,
        c.name category_name,
        c.nature category_nature
      FROM transactions t
      LEFT JOIN categories c
        ON c.id=t.category_id
      WHERE t.status!='void'
        AND COALESCE(t.opening_history,0)=0
        AND t.direction='expense'
        AND t.payment_method='credit'
        AND t.source_account_id=?
      ORDER BY t.occurred_at,t.id
    `).bind(accountId).all()
  ).results || [];

  const candidates = suspicious.filter(
    (t) => !isSaleFeeOrBillPayment(t.description)
  );

  const converted = [];
  const skipped = [];

  for (const t of candidates) {
    try {
      const result =
        await convertLegacyBankExpenseToCard(
          env.DB,
          card,
          t
        );

      if (result.converted) {
        converted.push({
          transaction_id: Number(t.id),
          item_id: result.item_id,
          bill_id: result.bill_id,
          amount_cents: Number(t.amount_cents || 0),
          description: t.description
        });
      } else {
        skipped.push({
          transaction_id: Number(t.id),
          reason: result.reason || 'já tratado'
        });
      }
    } catch (error) {
      skipped.push({
        transaction_id: Number(t.id),
        reason: String(error?.message || error)
      });
    }
  }

  const balanceAfterCardFix = Number(
    (await accountBalance(env.DB, accountId))?.balance_cents || 0
  );

  const difference =
    actualBalance -
    balanceAfterCardFix;

  let adjustmentId = null;

  if (difference !== 0) {
    const adjustment = await env.DB.prepare(`
      INSERT INTO account_balance_adjustments(
        account_id,
        previous_balance_cents,
        new_balance_cents,
        difference_cents,
        reason,
        notes
      )
      VALUES(?,?,?,?,?,?)
    `).bind(
      accountId,
      balanceAfterCardFix,
      actualBalance,
      difference,
      'Conciliação automática Mercado Pago v1.9.5',
      `[${AUTO_TAG}] Saldo real informado pelo usuário após saneamento automático de compras no cartão. ` +
      `Vendas no crédito/débito e respectivas taxas não foram canceladas.`
    ).run();

    adjustmentId =
      Number(adjustment.meta.last_row_id || 0) ||
      null;
  }

  const finalBalance = Number(
    (await accountBalance(env.DB, accountId))?.balance_cents || 0
  );

  const convertedTotal =
    converted.reduce(
      (sum, item) =>
        sum +
        Number(item.amount_cents || 0),
      0
    );

  return json({
    ok: true,
    version: VERSION,
    account_id: accountId,
    account_name: account.name,
    card_id: Number(card.id),
    balance_before_cents: balanceBefore,
    converted_count: converted.length,
    converted_total_cents: convertedTotal,
    converted,
    skipped,
    balance_after_card_fix_cents: balanceAfterCardFix,
    adjustment_id: adjustmentId,
    adjustment_cents: difference,
    actual_balance_cents: actualBalance,
    final_balance_cents: finalBalance,
    protected_rules: {
      credit_sales_preserved: true,
      card_sale_fees_preserved: true,
      credit_card_purchases_removed_from_bank: true
    }
  });
}

async function convertLegacyBankExpenseToCard(
  db,
  card,
  transaction
) {
  const marker =
    `[${AUTO_TAG}_FROM_TX:${Number(transaction.id)}]`;

  const exists = await db.prepare(`
    SELECT id,bill_id
    FROM credit_card_items
    WHERE status='posted'
      AND notes LIKE ?
    LIMIT 1
  `).bind(
    `%${marker}%`
  ).first();

  if (exists) {
    if (String(transaction.status) !== 'void') {
      await voidLegacyTransaction(
        db,
        transaction,
        marker
      );
    }

    return {
      converted: false,
      reason: 'compra já existe na fatura',
      item_id: Number(exists.id),
      bill_id: Number(exists.bill_id)
    };
  }

  const purchaseDate =
    isoDateFromValue(transaction.occurred_at) ||
    localDate();

  const classification =
    await classifyLegacyCardPurchase(
      db,
      transaction
    );

  const result =
    await createCardItemFromPayload(
      db,
      {
        purchase_date: purchaseDate,
        description:
          String(
            transaction.description ||
            'Compra no cartão Mercado Pago'
          ),
        amount_cents:
          positiveInt(
            transaction.amount_cents,
            'amount_cents'
          ),
        nature:
          classification.nature,
        category_id:
          classification.category_id,
        notes:
          appendNote(
            transaction.notes,
            `${marker} Convertido automaticamente de lançamento bancário para compra na fatura. ` +
            `Vínculos antigos: obrigação=${
              transaction.obligation_id ||
              'nenhuma'
            }, dívida=${
              transaction.debt_id ||
              'nenhuma'
            }.`
          ),
        source_transaction_id:
          Number(transaction.id),
        preferred_account_id:
          Number(transaction.source_account_id)
      }
    );

  try {
    await voidLegacyTransaction(
      db,
      transaction,
      marker
    );
  } catch (error) {
    await db.prepare(
      "UPDATE credit_card_items SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(
      result.item_id
    ).run().catch(() => null);

    await syncBill(
      db,
      result.bill_id
    ).catch(() => null);

    throw error;
  }

  return {
    converted: true,
    item_id: result.item_id,
    bill_id: result.bill_id
  };
}

async function voidLegacyTransaction(
  db,
  transaction,
  marker
) {
  const current =
    await db.prepare(
      'SELECT * FROM transactions WHERE id=?'
    ).bind(
      Number(transaction.id)
    ).first();

  if (
    !current ||
    current.status === 'void'
  ) {
    return;
  }

  let debtUpdate = null;

  if (
    current.debt_id &&
    current.direction === 'expense' &&
    !Number(current.opening_history || 0)
  ) {
    const debt =
      await db.prepare(
        'SELECT * FROM debts WHERE id=?'
      ).bind(
        Number(current.debt_id)
      ).first();

    if (
      debt &&
      debt.current_balance_cents != null
    ) {
      const restored =
        Number(debt.current_balance_cents || 0) +
        Number(current.amount_cents || 0);

      const nextBalance =
        debt.original_balance_cents == null
          ? restored
          : Math.min(
              Number(debt.original_balance_cents),
              restored
            );

      debtUpdate =
        db.prepare(`
          UPDATE debts
          SET current_balance_cents=?,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).bind(
          nextBalance,
          Number(debt.id)
        );
    }
  }

  const after = {
    ...current,
    status: 'void',
    notes:
      appendNote(
        current.notes,
        `${marker} Removido do saldo bancário; convertido para fatura do cartão.`
      )
  };

  const statements = [
    db.prepare(`
      UPDATE transactions
      SET status='void',
          notes=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      after.notes,
      Number(current.id)
    ),

    db.prepare(`
      INSERT INTO transaction_revisions(
        transaction_id,
        action,
        before_json,
        after_json
      )
      VALUES(?,?,?,?)
    `).bind(
      Number(current.id),
      'void',
      JSON.stringify(current),
      JSON.stringify(after)
    )
  ];

  if (debtUpdate) {
    statements.push(debtUpdate);
  }

  await db.batch(statements);
}

async function createCardItemFromPayload(
  db,
  payload
) {
  const accountId =
    Number(
      payload.preferred_account_id || 0
    ) ||
    null;

  const card =
    await ensureMercadoPagoCard(
      db,
      accountId
    );

  const billInfo =
    billForPurchase(
      payload.purchase_date,
      Number(card.closing_day || 11),
      Number(card.due_day || 17)
    );

  const bill =
    await ensureBill(
      db,
      card,
      billInfo
    );

  const classification =
    await resolveCategoryForNature(
      db,
      payload.nature,
      payload.category_id,
      payload.description
    );

  const detailedBefore = Number(
    (
      await db.prepare(`
        SELECT
          COALESCE(
            SUM(amount_cents),
            0
          ) total
        FROM credit_card_items
        WHERE bill_id=?
          AND status='posted'
      `).bind(
        Number(bill.id)
      ).first()
    )?.total || 0
  );

  const oldTotal =
    Number(bill.total_cents || 0);

  const newDetailed =
    detailedBefore +
    Number(payload.amount_cents);

  const newTotal =
    Math.max(
      oldTotal,
      newDetailed
    );

  const item =
    await db.prepare(`
      INSERT INTO credit_card_items(
        bill_id,
        purchase_date,
        description,
        amount_cents,
        scope,
        nature,
        category_id,
        installment_number,
        installment_total,
        notes,
        status
      )
      VALUES(
        ?,?,?,?,?,?,?,?,?,?,
        'posted'
      )
    `).bind(
      Number(bill.id),
      payload.purchase_date,
      payload.description,
      Number(payload.amount_cents),
      classification.scope,
      classification.nature,
      classification.category_id,
      null,
      null,
      payload.notes || null
    ).run();

  const itemId =
    Number(item.meta.last_row_id);

  try {
    await db.batch([
      db.prepare(`
        UPDATE credit_card_bills
        SET total_cents=?,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(
        newTotal,
        Number(bill.id)
      ),

      db.prepare(`
        INSERT INTO credit_card_revisions(
          entity_type,
          entity_id,
          action,
          before_json,
          after_json
        )
        VALUES(
          'item',
          ?,
          'create',
          NULL,
          ?
        )
      `).bind(
        itemId,
        JSON.stringify({
          bill_id:
            Number(bill.id),
          purchase_date:
            payload.purchase_date,
          description:
            payload.description,
          amount_cents:
            Number(payload.amount_cents),
          scope:
            classification.scope,
          nature:
            classification.nature,
          category_id:
            classification.category_id,
          source_transaction_id:
            payload.source_transaction_id ||
            null,
          auto_version:
            VERSION
        })
      )
    ]);
  } catch (error) {
    await db.prepare(
      "UPDATE credit_card_items SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(
      itemId
    ).run().catch(() => null);

    await db.prepare(
      'UPDATE credit_card_bills SET total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(
      oldTotal,
      Number(bill.id)
    ).run().catch(() => null);

    throw error;
  }

  await reallocateBill(
    db,
    Number(bill.id)
  );

  await syncBill(
    db,
    Number(bill.id)
  );

  return {
    item_id: itemId,
    bill_id: Number(bill.id),
    period_key: billInfo.period_key,
    scope: classification.scope,
    nature: classification.nature,
    category_id: classification.category_id
  };
}

async function classifyLegacyCardPurchase(
  db,
  transaction
) {
  const text =
    norm(
      `${transaction.description || ''} ` +
      `${transaction.notes || ''}`
    );

  const personalWords =
    /\b(mercado|supermercado|marmita|lanche|refeicao|comida|casa|pessoal|farmacia|roupa)\b/;

  const businessWords =
    /\b(loja|empresa|estoque|mercadoria|fornecedor|insumo|marketing|publicidade|frete|embalagem)\b/;

  let nature =
    normalizeNature(
      transaction.nature
    );

  if (
    transaction.category_nature ===
    'personal_withdrawal'
  ) {
    nature =
      'personal_withdrawal';
  } else if (
    personalWords.test(text) &&
    !businessWords.test(text)
  ) {
    nature =
      'personal_withdrawal';
  } else if (
    ![
      'business_operating',
      'inventory',
      'business_debt',
      'personal_withdrawal'
    ].includes(nature)
  ) {
    nature =
      'business_operating';
  }

  return resolveCategoryForNature(
    db,
    nature,
    nullablePositiveInt(
      transaction.category_id
    ),
    transaction.description
  );
}

async function resolveCategoryForNature(
  db,
  requestedNature,
  requestedCategoryId,
  description
) {
  const nature =
    normalizeNature(
      requestedNature
    );

  const scope =
    nature === 'personal_withdrawal'
      ? 'personal'
      : 'business';

  if (requestedCategoryId) {
    const category =
      await db.prepare(`
        SELECT
          id,
          name,
          nature,
          active
        FROM categories
        WHERE id=?
      `).bind(
        Number(requestedCategoryId)
      ).first();

    if (
      category &&
      Number(category.active) !== 0 &&
      category.nature === nature
    ) {
      return {
        scope,
        nature,
        category_id:
          Number(category.id)
      };
    }
  }

  const text =
    norm(description);

  const preferredNames = [];

  if (
    nature === 'personal_withdrawal'
  ) {
    if (
      /\b(mercado|supermercado|atacadista)\b/.test(
        text
      )
    ) {
      preferredNames.push(
        'Mercado pessoal'
      );
    }

    if (
      /\b(marmita|refeicao|comida|lanche)\b/.test(
        text
      )
    ) {
      preferredNames.push(
        'Marmita',
        'Refeição',
        'Alimentação pessoal'
      );
    }

    preferredNames.push(
      'Outros pessoais'
    );
  } else if (
    nature === 'inventory'
  ) {
    preferredNames.push(
      'Compras e estoque'
    );
  } else if (
    nature === 'business_debt'
  ) {
    preferredNames.push(
      'Pagamento de fatura de cartão',
      'Empréstimos e acordos'
    );
  } else {
    preferredNames.push(
      'Outros operacionais',
      'Outras despesas da empresa'
    );
  }

  for (
    const name of preferredNames
  ) {
    const category =
      await findOrActivateCategory(
        db,
        name,
        nature
      );

    if (category) {
      return {
        scope,
        nature,
        category_id:
          Number(category.id)
      };
    }
  }

  const first =
    await db.prepare(`
      SELECT id
      FROM categories
      WHERE nature=?
        AND active=1
      ORDER BY id
      LIMIT 1
    `).bind(
      nature
    ).first();

  if (first) {
    return {
      scope,
      nature,
      category_id:
        Number(first.id)
    };
  }

  const fallbackName =
    nature === 'personal_withdrawal'
      ? 'Outros pessoais'
      : nature === 'inventory'
        ? 'Compras e estoque'
        : nature === 'business_debt'
          ? 'Pagamento de fatura de cartão'
          : 'Outras despesas da empresa';

  const created =
    await db.prepare(`
      INSERT INTO categories(
        name,
        nature,
        active
      )
      VALUES(?,?,1)
    `).bind(
      fallbackName,
      nature
    ).run();

  return {
    scope,
    nature,
    category_id:
      Number(created.meta.last_row_id)
  };
}

async function findOrActivateCategory(
  db,
  name,
  nature
) {
  const category =
    await db.prepare(`
      SELECT
        id,
        name,
        nature,
        active
      FROM categories
      WHERE lower(trim(name))=
            lower(trim(?))
        AND nature=?
      LIMIT 1
    `).bind(
      name,
      nature
    ).first();

  if (!category) {
    return null;
  }

  if (!Number(category.active)) {
    await db.prepare(
      'UPDATE categories SET active=1 WHERE id=?'
    ).bind(
      Number(category.id)
    ).run();
  }

  return category;
}

async function ensureMercadoPagoCard(
  db,
  preferredAccountId
) {
  let card =
    await db.prepare(`
      SELECT *
      FROM credit_cards
      WHERE active=1
        AND (
          lower(trim(name))
            LIKE '%mercado pago%'
          OR
          lower(
            trim(
              COALESCE(issuer,'')
            )
          )='mercado pago'
        )
      ORDER BY id
      LIMIT 1
    `).first();

  if (!card) {
    const created =
      await db.prepare(`
        INSERT INTO credit_cards(
          name,
          issuer,
          limit_cents,
          closing_day,
          due_day,
          preferred_account_id,
          mixed_use,
          active,
          notes
        )
        VALUES(
          'Cartão Mercado Pago',
          'Mercado Pago',
          NULL,
          11,
          17,
          ?,
          1,
          1,
          ?
        )
      `).bind(
        preferredAccountId || null,
        `[${AUTO_TAG}] Cartão criado automaticamente pela v1.9.5.`
      ).run();

    card =
      await db.prepare(
        'SELECT * FROM credit_cards WHERE id=?'
      ).bind(
        Number(created.meta.last_row_id)
      ).first();

    return card;
  }

  const closingDay =
    Number(
      card.closing_day || 11
    );

  const dueDay =
    Number(
      card.due_day || 17
    );

  const preferred =
    card.preferred_account_id ||
    preferredAccountId ||
    null;

  if (
    Number(card.closing_day || 0) !== closingDay ||
    Number(card.due_day || 0) !== dueDay ||
    Number(card.preferred_account_id || 0) !==
      Number(preferred || 0)
  ) {
    await db.prepare(`
      UPDATE credit_cards
      SET closing_day=?,
          due_day=?,
          preferred_account_id=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      closingDay,
      dueDay,
      preferred,
      Number(card.id)
    ).run();

    card =
      await db.prepare(
        'SELECT * FROM credit_cards WHERE id=?'
      ).bind(
        Number(card.id)
      ).first();
  }

  return card;
}

async function ensureBill(
  db,
  card,
  info
) {
  let bill =
    await db.prepare(`
      SELECT *
      FROM credit_card_bills
      WHERE card_id=?
        AND period_key=?
        AND status!='void'
      LIMIT 1
    `).bind(
      Number(card.id),
      info.period_key
    ).first();

  if (bill) {
    return bill;
  }

  const billCategory =
    await ensureCategory(
      db,
      'Pagamento de fatura de cartão',
      'business_debt'
    );

  const obligation =
    await db.prepare(`
      INSERT INTO obligations(
        name,
        scope,
        nature,
        category_id,
        monthly_target_cents,
        due_day,
        due_date,
        recurring,
        flexible,
        priority,
        counts_in_daily_target,
        personal_ceiling_member,
        active,
        notes
      )
      VALUES(
        ?,?,?,?,?,?,?,?,?,?,?,?,
        1,
        ?
      )
    `).bind(
      `Fatura ${card.name} · ${periodLabel(info.period_key)}`,
      'business',
      'business_debt',
      Number(billCategory.id),
      0,
      Number(card.due_day || 17),
      info.due_date,
      0,
      0,
      1,
      1,
      0,
      `[CARD_BILL] ${info.period_key} [${AUTO_TAG}]`
    ).run();

  const created =
    await db.prepare(`
      INSERT INTO credit_card_bills(
        card_id,
        period_key,
        total_cents,
        due_date,
        closing_date,
        obligation_id,
        status,
        notes
      )
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      Number(card.id),
      info.period_key,
      0,
      info.due_date,
      info.closing_date,
      Number(obligation.meta.last_row_id),
      'paid',
      `[${AUTO_TAG}] Fatura criada automaticamente.`
    ).run();

  return db.prepare(
    'SELECT * FROM credit_card_bills WHERE id=?'
  ).bind(
    Number(created.meta.last_row_id)
  ).first();
}

async function ensureCategory(
  db,
  name,
  nature
) {
  let category =
    await db.prepare(`
      SELECT
        id,
        name,
        nature,
        active
      FROM categories
      WHERE lower(trim(name))=
            lower(trim(?))
        AND nature=?
      LIMIT 1
    `).bind(
      name,
      nature
    ).first();

  if (category) {
    if (!Number(category.active)) {
      await db.prepare(
        'UPDATE categories SET active=1 WHERE id=?'
      ).bind(
        Number(category.id)
      ).run();
    }

    return category;
  }

  const created =
    await db.prepare(`
      INSERT INTO categories(
        name,
        nature,
        active
      )
      VALUES(?,?,1)
    `).bind(
      name,
      nature
    ).run();

  return {
    id:
      Number(created.meta.last_row_id),
    name,
    nature,
    active: 1
  };
}

async function syncBill(
  db,
  billId
) {
  const bill =
    await db.prepare(
      'SELECT * FROM credit_card_bills WHERE id=?'
    ).bind(
      Number(billId)
    ).first();

  if (!bill) {
    return;
  }

  const paid =
    Number(
      (
        await db.prepare(`
          SELECT
            COALESCE(
              SUM(amount_cents),
              0
            ) total
          FROM credit_card_payments
          WHERE bill_id=?
            AND status='posted'
        `).bind(
          Number(billId)
        ).first()
      )?.total || 0
    );

  const remaining =
    Math.max(
      0,
      Number(bill.total_cents || 0) -
      paid
    );

  let status =
    remaining === 0
      ? 'paid'
      : paid > 0
        ? 'partial'
        : 'open';

  if (
    remaining > 0 &&
    String(bill.due_date) <
      localDate()
  ) {
    status =
      'overdue';
  }

  await db.prepare(`
    UPDATE credit_card_bills
    SET status=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    status,
    Number(billId)
  ).run();

  if (bill.obligation_id) {
    await db.prepare(`
      UPDATE obligations
      SET monthly_target_cents=?,
          due_day=?,
          due_date=?,
          active=?,
          notes=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      remaining,
      Number(
        String(bill.due_date).slice(
          8,
          10
        )
      ) || 17,
      bill.due_date,
      remaining > 0 ? 1 : 0,
      `[CARD_BILL:${Number(billId)}] saldo restante da fatura`,
      Number(bill.obligation_id)
    ).run();
  }
}

async function reallocateBill(
  db,
  billId
) {
  const payments = (
    await db.prepare(`
      SELECT *
      FROM credit_card_payments
      WHERE bill_id=?
        AND status='posted'
      ORDER BY paid_at,id
    `).bind(
      Number(billId)
    ).all()
  ).results || [];

  const items = (
    await db.prepare(`
      SELECT *
      FROM credit_card_items
      WHERE bill_id=?
        AND status='posted'
      ORDER BY purchase_date,id
    `).bind(
      Number(billId)
    ).all()
  ).results || [];

  if (payments.length) {
    const ids =
      payments.map(
        (p) => Number(p.id)
      );

    const placeholders =
      ids.map(() => '?').join(',');

    await db.prepare(`
      DELETE FROM credit_card_payment_allocations
      WHERE payment_id IN (${placeholders})
    `).bind(
      ...ids
    ).run();
  }

  const remainingByItem =
    new Map(
      items.map(
        (item) => [
          Number(item.id),
          Number(item.amount_cents || 0)
        ]
      )
    );

  for (const payment of payments) {
    let left =
      Number(
        payment.amount_cents || 0
      );

    for (const item of items) {
      if (left <= 0) {
        break;
      }

      const itemId =
        Number(item.id);

      const available =
        remainingByItem.get(
          itemId
        ) || 0;

      if (available <= 0) {
        continue;
      }

      const use =
        Math.min(
          left,
          available
        );

      await db.prepare(`
        INSERT INTO credit_card_payment_allocations(
          payment_id,
          item_id,
          amount_cents
        )
        VALUES(?,?,?)
      `).bind(
        Number(payment.id),
        itemId,
        use
      ).run();

      remainingByItem.set(
        itemId,
        available - use
      );

      left -= use;
    }
  }
}

async function accountBalance(
  db,
  id
) {
  return db.prepare(`
    SELECT
      a.id,
      a.name,

      a.opening_balance_cents

      + COALESCE((
          SELECT
            SUM(t.amount_cents)
          FROM transactions t
          WHERE
            t.destination_account_id=a.id
            AND t.status!='void'
            AND COALESCE(
              t.opening_history,
              0
            )=0
        ),0)

      - COALESCE((
          SELECT
            SUM(t.amount_cents)
          FROM transactions t
          WHERE
            t.source_account_id=a.id
            AND t.status!='void'
            AND COALESCE(
              t.opening_history,
              0
            )=0
        ),0)

      + COALESCE((
          SELECT
            SUM(x.difference_cents)
          FROM account_balance_adjustments x
          WHERE
            x.account_id=a.id
        ),0)

      AS balance_cents

    FROM accounts a
    WHERE
      a.id=?
      AND a.active=1
  `).bind(
    Number(id)
  ).first();
}

async function findMercadoPagoAccount(
  db
) {
  return db.prepare(`
    SELECT *
    FROM accounts
    WHERE active=1
      AND lower(name)
        LIKE '%mercado pago%'
    ORDER BY id
    LIMIT 1
  `).first();
}

function parseWhatsAppCardPurchase(
  text
) {
  let raw =
    String(text || '').trim();

  if (!raw) {
    return null;
  }

  let purchaseDate =
    localDate();

  const dateMatch =
    raw.match(
      /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/
    );

  if (dateMatch) {
    let year =
      dateMatch[3]
        ? Number(dateMatch[3])
        : Number(
            localDate().slice(0,4)
          );

    if (year < 100) {
      year += 2000;
    }

    purchaseDate =
      safeDate(
        year,
        Number(dateMatch[2]),
        Number(dateMatch[1])
      );

    if (!purchaseDate) {
      return null;
    }

    raw =
      raw
        .slice(
          dateMatch[0].length
        )
        .trim();
  }

  if (
    !/^(gasto|gastei|compra|comprei|paguei)\b/i.test(
      raw
    )
  ) {
    return null;
  }

  const restAfterVerb =
    raw.replace(
      /^(gasto|gastei|compra|comprei|paguei)\s+/i,
      ''
    );

  const amountMatch =
    restAfterVerb.match(
      /^((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?)\s+/
    );

  if (!amountMatch) {
    return null;
  }

  const amountCents =
    parseBRMoney(
      amountMatch[1]
    );

  if (amountCents <= 0) {
    return null;
  }

  let rest =
    restAfterVerb
      .slice(
        amountMatch[0].length
      )
      .trim();

  const normalized =
    norm(rest);

  const mentionsCard =
    /\b(credito|cartao|cartao de credito)\b/.test(
      normalized
    ) &&
    /\bmercado pago\b/.test(
      normalized
    );

  if (!mentionsCard) {
    return null;
  }

  if (
    /\btaxa mercado pago\b/.test(
      normalized
    )
  ) {
    return null;
  }

  if (
    /\bfatura\b/.test(
      normalized
    )
  ) {
    return null;
  }

  let scope = null;

  if (
    /\bpessoal\b|\buso pessoal\b/.test(
      normalized
    )
  ) {
    scope = 'personal';
  } else if (
    /\bempresa\b|\bempresarial\b|\bloja\b|\bestoque\b|\bmercadoria\b|\bfornecedor\b|\bmarketing\b/.test(
      normalized
    )
  ) {
    scope = 'business';
  } else if (
    /\bmercado\b|\bsupermercado\b|\bmarmita\b|\blanche\b|\brefeicao\b|\bcasa\b/.test(
      normalized
    )
  ) {
    scope = 'personal';
  }

  rest = rest
    .replace(
      /\b(?:no\s+)?(?:credito|crédito|cartao|cartão)(?:\s+de\s+(?:credito|crédito))?\s+(?:do\s+)?mercado\s*pago\b/ig,
      ' '
    )
    .replace(
      /\bmercado\s*pago\s+(?:credito|crédito|cartao|cartão)\b/ig,
      ' '
    )
    .replace(
      /\b(?:pessoal|empresa|empresarial)\b/ig,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

  return {
    purchase_date:
      purchaseDate,

    amount_cents:
      amountCents,

    description:
      rest ||
      'Compra no Cartão Mercado Pago',

    scope
  };
}

function isSaleFeeOrBillPayment(
  description
) {
  const value =
    norm(description);

  return (
    /^taxa mercado pago\b/.test(value) ||
    /\btaxa\b.*\bmercado pago\b/.test(value) ||
    /\bpagamento\b.*\bfatura\b/.test(value) ||
    /\bfatura\b.*\bmercado pago\b/.test(value)
  );
}

function inferBusinessNature(
  description
) {
  const value =
    norm(description);

  if (
    /\b(estoque|mercadoria|fornecedor|produto|insumo|materia prima)\b/.test(
      value
    )
  ) {
    return 'inventory';
  }

  return 'business_operating';
}

function normalizeNature(
  value
) {
  const nature =
    String(
      value ||
      'business_operating'
    );

  if (
    [
      'business_operating',
      'inventory',
      'business_debt',
      'personal_withdrawal'
    ].includes(nature)
  ) {
    return nature;
  }

  return 'business_operating';
}

function isMercadoPagoName(
  value
) {
  return norm(value)
    .includes(
      'mercado pago'
    );
}

function billForPurchase(
  dateStr,
  closingDay,
  dueDay
) {
  const [
    yearRaw,
    monthRaw,
    dayRaw
  ] =
    String(dateStr)
      .split('-')
      .map(Number);

  let year =
    yearRaw;

  let month =
    monthRaw;

  if (
    dayRaw >
    closingDay
  ) {
    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const periodKey =
    `${year}-${String(month).padStart(2,'0')}`;

  return {
    period_key:
      periodKey,

    due_date:
      makeDateClamped(
        year,
        month,
        dueDay
      ),

    closing_date:
      makeDateClamped(
        year,
        month,
        closingDay
      )
  };
}

function makeDateClamped(
  year,
  month,
  day
) {
  const last =
    new Date(
      Date.UTC(
        year,
        month,
        0
      )
    ).getUTCDate();

  const safeDay =
    Math.min(
      Math.max(
        1,
        Number(day)
      ),
      last
    );

  return (
    `${year}-` +
    `${String(month).padStart(2,'0')}-` +
    `${String(safeDay).padStart(2,'0')}`
  );
}

function safeDate(
  year,
  month,
  day
) {
  if (
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return null;
  }

  const last =
    new Date(
      Date.UTC(
        year,
        month,
        0
      )
    ).getUTCDate();

  if (day > last) {
    return null;
  }

  return (
    `${year}-` +
    `${String(month).padStart(2,'0')}-` +
    `${String(day).padStart(2,'0')}`
  );
}

function isoDateFromValue(
  value
) {
  const match =
    String(value || '')
      .match(
        /^(\d{4}-\d{2}-\d{2})/
      );

  return match
    ? match[1]
    : null;
}

function localDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(
    new Date()
  );
}

function parseBRMoney(
  value
) {
  let s =
    String(value || '')
      .trim()
      .replace(
        /R\$/gi,
        ''
      )
      .replace(
        /\s/g,
        ''
      );

  if (
    s.includes(',') &&
    s.includes('.')
  ) {
    s =
      s
        .replace(
          /\./g,
          ''
        )
        .replace(
          ',',
          '.'
        );
  } else if (
    s.includes(',')
  ) {
    s =
      s.replace(
        ',',
        '.'
      );
  } else if (
    (s.match(/\./g) || [])
      .length > 1
  ) {
    s =
      s.replace(
        /\./g,
        ''
      );
  } else if (
    /^\d{1,3}\.\d{3}$/.test(s)
  ) {
    s =
      s.replace(
        '.',
        ''
      );
  }

  const number =
    Number(s);

  return Number.isFinite(number)
    ? Math.round(number * 100)
    : 0;
}

function positiveInt(
  value,
  field
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      `${field} inválido.`
    );
  }

  return number;
}

function nonNegativeInt(
  value,
  field
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    throw new Error(
      `${field} inválido.`
    );
  }

  return number;
}

function nullablePositiveInt(
  value
) {
  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

function appendNote(
  current,
  addition
) {
  const left =
    String(current || '')
      .trim();

  const right =
    String(addition || '')
      .trim();

  return [
    left,
    right
  ]
    .filter(Boolean)
    .join(' ');
}

function norm(
  value
) {
  return String(value || '')
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function digits(
  value
) {
  return String(value || '')
    .replace(
      /\D/g,
      ''
    );
}

function samePhone(
  a,
  b
) {
  const aa =
    digits(a);

  const bb =
    digits(b);

  if (
    !aa ||
    !bb
  ) {
    return false;
  }

  if (aa === bb) {
    return true;
  }

  const variants =
    (value) => {
      const set =
        new Set([value]);

      const local =
        value.startsWith('55')
          ? value.slice(2)
          : value;

      set.add(local);

      if (
        local.length === 11 &&
        local[2] === '9'
      ) {
        set.add(
          local.slice(0,2) +
          local.slice(3)
        );
      }

      if (
        local.length === 10
      ) {
        set.add(
          local.slice(0,2) +
          '9' +
          local.slice(2)
        );
      }

      return set;
    };

  const A =
    variants(aa);

  const B =
    variants(bb);

  for (const value of A) {
    if (B.has(value)) {
      return true;
    }
  }

  return false;
}

function brl(
  cents
) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL'
    }
  ).format(
    Number(cents || 0) /
    100
  );
}

function periodLabel(
  key
) {
  const [
    year,
    month
  ] =
    String(key)
      .split('-');

  const names = [
    '',
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez'
  ];

  return (
    `${names[Number(month)] || month}/${year}`
  );
}

function v195EnhancementMarkup() {
  return `
<style data-pf-v195>
  .pf-conc-dialog{
    width:min(96vw,1100px)!important;
    max-height:94vh!important
  }

  .pf-v195-auto{
    background:#172136!important;
    border-color:#172136!important;
    color:#fff!important
  }

  .pf-v195-note{
    margin-top:10px;
    padding:10px 12px;
    border:1px solid #dfe4ed;
    border-radius:12px;
    background:#f8f9fc;
    color:#596579;
    font-size:10px;
    line-height:1.45
  }

  @media(max-width:640px){
    .pf-conc-dialog{
      width:97vw!important;
      max-height:95vh!important
    }

    .pf-v195-auto{
      width:100%
    }
  }
</style>

<script data-pf-v195>
(function(){
  'use strict';

  function parseMoney(value){
    var s=
      String(value||'')
        .trim()
        .replace(/\\s/g,'');

    if(!s){
      return null;
    }

    if(
      s.indexOf(',')>=0 &&
      s.indexOf('.')>=0
    ){
      s=
        s.replace(/\\./g,'')
         .replace(',','.');
    }
    else if(
      s.indexOf(',')>=0
    ){
      s=
        s.replace(',','.');
    }
    else if(
      (s.match(/\\./g)||[]).length>1
    ){
      s=
        s.replace(/\\./g,'');
    }
    else if(
      /^\\d{1,3}\\.\\d{3}$/.test(s)
    ){
      s=
        s.replace('.','');
    }

    var n=
      Number(s);

    return (
      Number.isFinite(n) &&
      n>=0
    )
      ? Math.round(n*100)
      : null;
  }

  function money(cents){
    return new Intl.NumberFormat(
      'pt-BR',
      {
        style:'currency',
        currency:'BRL'
      }
    ).format(
      Number(cents||0)/100
    );
  }

  function install(){
    var reconcile=
      document.getElementById(
        'pfBankReconcile'
      );

    var account=
      document.getElementById(
        'pfBankAccount'
      );

    var actual=
      document.getElementById(
        'pfBankActual'
      );

    if(
      !reconcile ||
      !account ||
      !actual
    ){
      return false;
    }

    if(
      document.getElementById(
        'pfV195AutoRepair'
      )
    ){
      return true;
    }

    var button=
      document.createElement(
        'button'
      );

    button.type='button';
    button.id='pfV195AutoRepair';
    button.className=
      'pf-conc-btn pf-v195-auto';

    button.textContent=
      'Corrigir automaticamente';

    reconcile.parentNode
      .insertBefore(
        button,
        reconcile
      );

    var note=
      document.createElement(
        'div'
      );

    note.className=
      'pf-v195-note';

    note.innerHTML=
      '<b>v1.9.5 automático:</b> '+
      'separa compra feita no Cartão Mercado Pago de venda da loja no crédito. '+
      'Vendas e taxas de venda são preservadas. '+
      'Depois fecha a diferença contra o saldo real informado, com registro de auditoria.';

    reconcile
      .closest(
        '.pf-conc-card'
      )
      .appendChild(
        note
      );

    button.addEventListener(
      'click',
      async function(){
        var accountId=
          Number(
            account.value||0
          );

        var actualCents=
          parseMoney(
            actual.value
          );

        if(!accountId){
          alert(
            'Selecione a conta Mercado Pago.'
          );
          return;
        }

        if(actualCents===null){
          alert(
            'Informe o saldo real atual do Mercado Pago.'
          );
          return;
        }

        if(
          !confirm(
            'Executar o reparo automático?\\n\\n'+
            'O sistema NÃO cancelará vendas da loja no crédito nem taxas dessas vendas.\\n'+
            'Compras feitas no Cartão Mercado Pago que reduziram o banco serão movidas para a fatura.\\n'+
            'Depois o saldo será conciliado com o valor real informado.'
          )
        ){
          return;
        }

        var old=
          button.textContent;

        button.disabled=true;
        button.textContent=
          'Corrigindo...';

        try{
          var response=
            await fetch(
              '/api/v195/repair-mercado-pago',
              {
                method:'POST',
                headers:{
                  'content-type':
                    'application/json'
                },
                body:
                  JSON.stringify({
                    account_id:
                      accountId,
                    actual_balance_cents:
                      actualCents
                  })
              }
            );

          var data=
            await response
              .json()
              .catch(
                function(){
                  return {};
                }
              );

          if(!response.ok){
            throw new Error(
              data.error ||
              ('Erro '+response.status)
            );
          }

          alert(
            'Conciliação concluída.\\n\\n'+
            'Compras no cartão corrigidas: '+
            data.converted_count+
            '\\n'+
            'Total movido do banco para a fatura: '+
            money(
              data.converted_total_cents
            )+
            '\\n'+
            'Ajuste final de conciliação: '+
            money(
              data.adjustment_cents
            )+
            '\\n'+
            'Saldo final Mercado Pago: '+
            money(
              data.final_balance_cents
            )+
            '\\n\\n'+
            'Vendas no crédito e taxas de venda foram preservadas.'
          );

          location.reload();
        }
        catch(error){
          alert(
            error.message ||
            String(error)
          );

          button.disabled=false;
          button.textContent=old;
        }
      }
    );

    return true;
  }

  var tries=0;

  var timer=
    setInterval(
      function(){
        tries+=1;

        if(
          install() ||
          tries>=60
        ){
          clearInterval(timer);
        }
      },
      250
    );
})();
</script>`;
}

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store'
      }
    }
  );
}
