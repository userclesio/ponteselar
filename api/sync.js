// api/sync.js — Ponte Selar -> UTMify (polling)
//
// Credenciais: lidas de variáveis de ambiente (Vercel) OU dos headers
// enviados pelo dashboard (x-selar-key, x-utmify-token, etc.).
// Env vars têm prioridade — se não existirem, usa os headers do request.

let kv = null;
try { kv = require("@vercel/kv").kv; } catch (_) { kv = null; }

// ----------------------------------------------------------------------
// DEDUPLICAÇÃO
// ----------------------------------------------------------------------
async function alreadySent(orderId) {
  if (!kv) return false;
  try { return (await kv.get(`sent:${orderId}`)) === 1; } catch { return false; }
}

async function markSent(orderId) {
  if (!kv) return;
  try { await kv.set(`sent:${orderId}`, 1, { ex: 60 * 60 * 24 * 7 }); } catch { /* ignore */ }
}

// ----------------------------------------------------------------------
// SELAR: buscar vendas recentes
// ----------------------------------------------------------------------
async function fetchSelarOrders(cfg) {
  const since = new Date(Date.now() - cfg.windowMinutes * 60 * 1000).toISOString();
  const url = `${cfg.selarBase}${cfg.selarPath}?since=${encodeURIComponent(since)}`;

  const headers = { "Content-Type": "application/json" };
  headers[cfg.selarAuthHeader] = `Bearer ${cfg.selarKey}`;

  const res = await fetch(url, { method: "GET", headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Selar respondeu ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.data || data.results || data.transactions || data.orders || [];
}

// ----------------------------------------------------------------------
// TRADUÇÃO: Selar -> UTMify
// ----------------------------------------------------------------------
function mapSelarToUtmify(order) {
  return {
    orderId:       String(order.id),
    platform:      "Selar",
    paymentMethod: order.payment_method || null,
    status:        order.status         || null,
    createdAt:     order.created_at     || null,
    approvedDate:  order.paid_at        || null,
    customer: {
      name:  order.customer_name  || null,
      email: order.customer_email || null,
      phone: order.customer_phone || null,
    },
    products: [{
      id:           String(order.product_id || ""),
      name:         order.product_name || "",
      priceInCents: toCents(order.amount),
      quantity:     order.quantity || 1,
    }],
    commission: {
      totalPriceInCents:    toCents(order.amount),
      gatewayFeeInCents:    toCents(order.fee   || 0),
      userCommissionInCents:toCents(order.net   || 0),
    },
    trackingParameters: {
      utm_source:   order.utm_source   || null,
      utm_medium:   order.utm_medium   || null,
      utm_campaign: order.utm_campaign || null,
      utm_content:  order.utm_content  || null,
      utm_term:     order.utm_term     || null,
    },
  };
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

// ----------------------------------------------------------------------
// UTMify: enviar pedido
// ----------------------------------------------------------------------
async function sendToUtmify(payload, cfg) {
  const res = await fetch(cfg.utmifyUrl, {
    method: "POST",
    headers: {
      [cfg.utmifyHeader]: cfg.utmifyToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`UTMify respondeu ${res.status}: ${text}`);
  return text;
}

// ----------------------------------------------------------------------
// HANDLER PRINCIPAL
// ----------------------------------------------------------------------
export default async function handler(req, res) {
  // ── Credenciais: env var tem prioridade; fallback = header do dashboard ──
  const cfg = {
    selarKey:        process.env.SELAR_API_KEY      || req.headers["x-selar-key"]        || "",
    selarBase:       process.env.SELAR_API_BASE      || req.headers["x-selar-base"]       || "https://api.selar.com",
    selarPath:       process.env.SELAR_ORDERS_PATH   || req.headers["x-selar-path"]       || "/v1/transactions",
    selarAuthHeader: process.env.SELAR_AUTH_HEADER   || req.headers["x-selar-auth-header"]|| "Authorization",
    utmifyToken:     process.env.UTMIFY_API_TOKEN    || req.headers["x-utmify-token"]     || "",
    utmifyUrl:       process.env.UTMIFY_URL          || req.headers["x-utmify-url"]       || "https://api.utmify.com.br/api-credentials/orders",
    utmifyHeader:    process.env.UTMIFY_AUTH_HEADER  || req.headers["x-utmify-header"]    || "x-api-token",
    windowMinutes:   Number(process.env.WINDOW_MINUTES || req.headers["x-window-minutes"] || 15),
    cronSecret:      process.env.CRON_SECRET         || "",
  };

  // ── Validação de credenciais obrigatórias ──
  if (!cfg.selarKey)    return res.status(400).json({ error: "SELAR_API_KEY não configurada" });
  if (!cfg.utmifyToken) return res.status(400).json({ error: "UTMIFY_API_TOKEN não configurado" });

  // ── Proteção do endpoint ──
  const auth = req.headers["authorization"] || "";
  if (cfg.cronSecret && auth !== `Bearer ${cfg.cronSecret}`) {
    return res.status(401).json({ error: "não autorizado" });
  }

  const result = { fetched: 0, sent: 0, skipped: 0, errors: [] };

  try {
    const orders = await fetchSelarOrders(cfg);
    result.fetched = orders.length;

    for (const order of orders) {
      const orderId = String(order.id);

      if (await alreadySent(orderId)) {
        result.skipped++;
        continue;
      }

      try {
        const payload = mapSelarToUtmify(order);
        await sendToUtmify(payload, cfg);
        await markSent(orderId);
        result.sent++;
      } catch (err) {
        result.errors.push({ orderId, message: err.message });
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message, ...result });
  }
}
