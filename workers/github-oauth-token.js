/**
 * Cloudflare Worker: GitHub OAuth token exchange proxy for Storage Hub.
 *
 * Deploy: Cloudflare dashboard → Workers → Create → paste this file → Deploy.
 * Route: e.g. https://github-oauth-token.<your-subdomain>.workers.dev/api/github/oauth/token
 * Then set GITHUB_TOKEN_EXCHANGE_URL in js/config.js to that URL (no trailing slash).
 */

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const TOKEN_PATH = '/api/github/oauth/token';

/** Origins allowed to call this worker (add your GitHub Pages URL). */
const ALLOWED_ORIGINS = new Set([
  'https://fi3ik-mme.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== TOKEN_PATH) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    }

    const upstream = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'StorageHub-TokenProxy',
      },
      body: await request.text(),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    });
  },
};
