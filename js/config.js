// Replace with your Google Cloud OAuth 2.0 Web Client ID.
// See README.md for setup instructions.
const CONFIG = {
  // Must match your GitHub repo name on GitHub Pages.
  BASE_PATH: typeof SITE !== 'undefined' ? SITE.basePath : '/storage-hub',
  CLIENT_ID: '1048248785186-1pq9mf68o2h8sggqikfvtmdcf446q4g8.apps.googleusercontent.com',
  // GitHub OAuth App Client ID. Callback URL must match GitHub app settings (see README).
  // Optional override: GITHUB_REDIRECT_URI: 'http://localhost:8080/github-oauth-callback.html',
  // Optional token proxy (serve.py or Cloudflare Worker — see README):
  // GITHUB_TOKEN_EXCHANGE_URL: 'http://localhost:8080/api/github/oauth/token',
  // GITHUB_TOKEN_EXCHANGE_URL: 'https://your-worker.workers.dev/api/github/oauth/token',
  // IDE preview (port 63342) uses personal access token sign-in by default; set true to force PAT everywhere:
  // GITHUB_USE_PAT: true,
  //GITHUB_CLIENT_ID: 'Ov23liUQICCVDKIO1eT3',
  GITHUB_CLIENT_ID: 'Ov23liTZlYZHUnrINYnk',
  GITHUB_SCOPES: 'repo',
  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
  ].join(' '),
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
};
