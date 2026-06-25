// api/ty-hit.js
// Recebe hit de uma Thank You Page e envia para a UTMify.
// Chamado pelo browser (public/ty.html) via POST.
//
// Token UTMify: usa env var UTMIFY_API_TOKEN (Vercel) ou header x-utmify-token (fallback).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-utmify-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const {
    pageId    = 'ty',
    productId = 'ty_product',
    productName,
    priceInCents = 0,
    visitorId,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  } = req.body || {};

  const utmifyToken  = process.env.UTMIFY_API_TOKEN   || req.headers['x-utmify-token'] || '';
  const utmifyUrl    = process.env.UTMIFY_URL          || 'https://api.utmify.com.br/api-credentials/orders';
  const utmifyHeader = process.env.UTMIFY_AUTH_HEADER  || 'x-api-token';

  if (!utmifyToken) {
    return res.status(400).json({ error: 'UTMIFY_API_TOKEN não configurado' });
  }

  const orderId = `ty_${pageId}_${visitorId || 'anon'}_${Date.now()}`;

  const payload = {
    orderId,
    platform:      'ThankYouPage',
    paymentMethod: 'credit_card',
    status:        'paid',
    createdAt:     new Date().toISOString(),
    approvedDate:  new Date().toISOString(),
    customer: {
      name:  'Visitante',
      email: `visitor_${(visitorId || 'anon').slice(0, 8)}@thankyoupage.local`,
      phone: null,
    },
    products: [{
      id:           String(productId),
      name:         productName || 'Produto',
      priceInCents: Number(priceInCents) || 0,
      quantity:     1,
    }],
    commission: {
      totalPriceInCents:     Number(priceInCents) || 0,
      gatewayFeeInCents:     0,
      userCommissionInCents: Number(priceInCents) || 0,
    },
    trackingParameters: {
      utm_source:   utm_source   || null,
      utm_medium:   utm_medium   || null,
      utm_campaign: utm_campaign || null,
      utm_content:  utm_content  || null,
      utm_term:     utm_term     || null,
    },
  };

  try {
    const r = await fetch(utmifyUrl, {
      method: 'POST',
      headers: {
        [utmifyHeader]: utmifyToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status).json({ error: `UTMify ${r.status}: ${text}` });
    }

    return res.status(200).json({ ok: true, orderId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
