# Ponte Selar -> UTMify

App simples (serverless na Vercel) que busca vendas no Selar e envia para a UTMify.
Como o Selar nao tem webhook de saida, usamos **polling**: um cron job consulta a
API do Selar a cada 5 minutos e empurra as vendas novas para a UTMify.

## Arquitetura

```
Cron (Vercel, a cada 5 min)
        |
        v
/api/sync.js  --(GET, SELAR_API_KEY)-->  API do Selar  (lista vendas recentes)
        |
        |  traduz formato Selar -> formato UTMify
        v
   POST (UTMIFY_API_TOKEN) --> https://api.utmify.com.br/api-credentials/orders
```

## O que VOCE precisa preencher antes de funcionar

Procure por `>>> AJUSTAR <<<` no arquivo `api/sync.js`. Os pontos sao:

1. **Endpoint e auth do Selar** (`SELAR_API_BASE`, `SELAR_ORDERS_PATH`, header de auth).
   Pegue na doc de desenvolvedor do Selar.
2. **Nomes dos campos da resposta do Selar** (onde esta o array de vendas, id, email,
   valor, status, e principalmente os parametros UTM).
3. **Formato exato do body da UTMify** e o nome do header de autenticacao
   (`mapSelarToUtmify` e `sendToUtmify`). Pegue na doc da API da UTMify.

> Importante: confirme se o Selar guarda os parametros UTM (utm_source etc.) na venda.
> Se nao guardar, a UTMify recebe a venda mas sem origem de trafego, que e justamente
> o que voce quer rastrear.

## Deploy

1. Suba este repo no GitHub.
2. Importe na Vercel (New Project -> Import).
3. Em Settings > Environment Variables, configure:
   - `SELAR_API_KEY` (a chave NOVA, depois de regenerar a exposta)
   - `UTMIFY_API_TOKEN`
   - `CRON_SECRET` (string aleatoria longa)
4. (Opcional, recomendado) Crie um Vercel KV store e conecte ao projeto, para a
   deduplicacao persistente. Sem KV, o app confia na janela de tempo (WINDOW_MINUTES)
   e pode, em casos de borda, duplicar ou perder uma venda.
5. O cron em `vercel.json` ja chama `/api/sync` a cada 5 min.

## Testar

Localmente com a Vercel CLI:

```bash
npm install
vercel dev
# noutro terminal:
curl -H "Authorization: Bearer SEU_CRON_SECRET" http://localhost:3000/api/sync
```

A resposta mostra `{ fetched, sent, skipped, errors }`.

## Seguranca

- Nenhuma credencial fica no codigo: tudo vem de variaveis de ambiente.
- O endpoint `/api/sync` exige o header `Authorization: Bearer CRON_SECRET`.
- A chave do Selar que foi exposta em chat deve ser regenerada antes de usar.
