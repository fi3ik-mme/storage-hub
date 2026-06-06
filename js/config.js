// Replace with your Google Cloud OAuth 2.0 Web Client ID.
// See README.md for setup instructions.
const CONFIG = {
  // Must match your GitHub repo name on GitHub Pages.
  BASE_PATH: typeof SITE !== 'undefined' ? SITE.basePath : '/mikus-drive',
  CLIENT_ID: '218406181224-47iproj29idug4uvlc63u569l375dju6.apps.googleusercontent.com',
  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
  ].join(' '),
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
};
