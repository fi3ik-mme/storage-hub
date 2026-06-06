# Mikus Drive

A web file manager for one or more Google Drive accounts, developed by [Mykhailo Mikus](https://github.com/MishaMikusEleks). Browse folders, copy files between users, edit `.txt`/`.json` in Notepad, and share deep links — works on desktop and mobile, and deploys to GitHub Pages.

**Live demo:** [https://mishamikuseleks.github.io/mikus-drive/](https://mishamikuseleks.github.io/mikus-drive/)

**Legal pages (for Google OAuth consent screen):**

| Field | URL |
|-------|-----|
| Application home page | https://mishamikuseleks.github.io/mikus-drive/ |
| Privacy policy | https://mishamikuseleks.github.io/mikus-drive/privacy.html |
| Terms of Service | https://mishamikuseleks.github.io/mikus-drive/terms.html |

> **Note:** Mikus Drive is an independent project and is not affiliated with Google LLC.

## Features

- Multi-user Google sign-in (add several Drive accounts)
- Windows-style explorer: tree, breadcrumbs, grid/list views, context menus
- Path-based URLs (e.g. `/mikus-drive/jane.doe/My%20Drive/Projects`)
- Cross-user cut/copy/paste
- Built-in Notepad for text files (opens in a new tab)
- Mobile layout with slide-out navigation
- Offline shell caching via `sw.js` (service worker)

## Quick start (local)

### 1. Google Cloud project

See [Google OAuth setup for external users](#google-oauth-setup-for-external-users) below.

### 2. Configure the app

Edit `js/config.js` (or `js/site-config.js` for branding and base path):

```js
const CONFIG = {
  BASE_PATH: '/mikus-drive', // must match your GitHub repo name
  CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  SCOPES: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive',
  ].join(' '),
};
```

Never commit OAuth client secrets or downloaded `client_secret_*.json` files.

### 3. Run locally

OAuth requires HTTP (not `file://`):

```bash
python3 serve.py
# or: python3 -m http.server 8080
```

Open `http://localhost:8080` (or the port shown). Add that origin in Google Cloud **Authorized JavaScript origins**.

---

## Deploy to GitHub Pages

### 1. Rename the repository (if migrating from `my_google`)

In GitHub: **Settings → General → Repository name** → rename to `mikus-drive`.

Then update your local remote:

```bash
git remote set-url origin https://github.com/MishaMikusEleks/mikus-drive.git
```

GitHub Pages will serve the app at `https://mishamikuseleks.github.io/mikus-drive/`.

### 2. Push and enable Pages

Enable **GitHub Pages** for the repo:

- **Settings → Pages → Build and deployment → Source:** Deploy from branch
- Branch: `main` (or `master`), folder: `/ (root)`

### 3. Files required for SPA routing

This repo includes:

| File | Purpose |
|------|---------|
| `404.html` | GitHub Pages SPA fallback (same as `index.html`) |
| `sw.js` | Caches static assets; serves shell on offline navigation |
| `.nojekyll` | Ensures GitHub Pages serves all paths as static files |
| `js/base-path.js` | Detects `/repo-name` base path automatically |

### 4. Base path

For a project site (`username.github.io/repo-name`), set the base path in `js/site-config.js`:

```js
basePath: '/mikus-drive',
```

### 5. Update Google OAuth origins

Add these **Authorized JavaScript origins** in Google Cloud Console:

- `https://mishamikuseleks.github.io`
- `https://mishamikuseleks.github.io/mikus-drive`
- `http://localhost:8080` (and any local port you use)

No redirect URI is required for the Google Identity Services token client used by this app.

---

## Google OAuth branding verification

Google requires a unique app name and proof that you own the homepage ([requirements](https://support.google.com/cloud/answer/13807376)). The most common failure is Search Console ownership not linked to your Cloud project.

### Critical: use the same Google account everywhere

The Google account that verifies the site in **Search Console** must also be **Owner** or **Editor** on your **Google Cloud** project (the one with your OAuth client). If you verified with a personal Gmail but your Cloud project uses a work account, Google will still report “website not registered to you.”

Check Cloud project access: [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam) — your verifying account must be listed as Owner or Editor.

### Step 1 — Verify in Google Search Console

1. Open [Google Search Console](https://search.google.com/search-console) **while signed in with the same account as your Cloud project**.
2. Click **Add property** → choose **URL prefix** (not “Domain”).
3. Enter exactly: `https://mishamikuseleks.github.io/mikus-drive/`
4. Pick a verification method:

   **Option A — HTML tag (recommended)**  
   Google gives you a meta tag like:
   ```html
   <meta name="google-site-verification" content="YOUR_TOKEN" />
   ```
   - Copy the `content` value.
   - Put it in `js/site-config.js` → `googleSiteVerification`.
   - Also update the static meta tag inside `<head>` in `index.html`, `404.html`, `privacy.html`, and `terms.html` (Google’s crawler reads static HTML; it does not run JavaScript).
   - Push to GitHub Pages, wait ~1 minute, then click **Verify** in Search Console.

   **Option B — HTML file**  
   Google gives you a file like `googleXXXXXXXX.html`. This repo already includes `google73af96c778f7385a.html` at the site root. After deploy it must be reachable at:
   `https://mishamikuseleks.github.io/mikus-drive/google73af96c778f7385a.html`  
   If Search Console gave you a *different* filename, replace the file in the repo root with the one Google provided.

5. Confirm Search Console shows **Ownership verified** for the URL prefix property.

### Step 2 — Match OAuth consent screen URLs

In [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent), set:

| Field | Value |
|-------|-------|
| App name | Mikus Drive |
| User support email | your email |
| App logo | upload `assets/logo-512.png` |
| Application home page | https://mishamikuseleks.github.io/mikus-drive/ |
| Privacy policy | https://mishamikuseleks.github.io/mikus-drive/privacy.html |
| Terms of Service | https://mishamikuseleks.github.io/mikus-drive/terms.html |

Under **Authorized domains**, Google may list `github.io`. You cannot verify `github.io` itself — verify the **URL prefix** property above instead. Google’s OAuth check links your verified Search Console property to the homepage URL on the consent screen.

### Step 3 — Resubmit verification

After Search Console shows verified:

1. Open the OAuth verification request in Cloud Console.
2. Confirm the homepage URL is exactly `https://mishamikuseleks.github.io/mikus-drive/`.
3. Resubmit for verification (or reply to Google’s email confirming ownership is verified).

### If verification still fails

GitHub Pages on `*.github.io` is a shared platform. If Google continues to reject it, the reliable fix is a **custom domain** you own (e.g. `mikusdrive.dev`):

1. Buy a domain and add it in GitHub Pages → **Settings → Pages → Custom domain**.
2. Verify that domain in Search Console (DNS TXT record).
3. Update homepage, privacy, and terms URLs on the OAuth consent screen to use the custom domain.
4. Add the custom domain origin to **Authorized JavaScript origins**.

### App name

Use **Mikus Drive** (not a generic name like "My Google"). The OAuth consent screen app name must match the branding shown on your homepage.

### OAuth consent screen URLs (reference)

The table above is the single source of truth for consent screen URLs. After updating, save and resubmit for verification.

---

## Google OAuth setup for external users

Use this checklist so **anyone** (not just you) can sign in when you publish the app.

### Step 1 — Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (e.g. "Mikus Drive")

### Step 2 — Enable Google Drive API

1. **APIs & Services → Library**
2. Search **Google Drive API** → **Enable**

### Step 3 — OAuth consent screen (External)

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Fill in:
   - **App name** — **Mikus Drive**
   - **User support email** — your email
   - **Developer contact email** — your email
4. **Scopes → Add or remove scopes**, add:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/drive` (full Drive access — **sensitive**)
5. **Test users** (while app is in *Testing*):
   - Add every Google account that should be allowed to sign in during development
   - Only test users can authenticate until the app is published

### Step 4 — Publish for production (any external user)

While the app is in **Testing**, only listed test users can sign in.

To allow **any Google user**:

1. **OAuth consent screen → Publish app**
2. For the **Drive** scope, Google may require **app verification** before public users see a trusted consent screen. Until verified, users may see an "unverified app" warning and must click **Advanced → Go to … (unsafe)**.
3. Submit verification if you need a production-ready, trusted consent screen for a public audience.

### Step 5 — OAuth 2.0 Client ID (Web application)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. **Authorized JavaScript origins** — add every URL where the app is hosted:

   | Environment | Example origin |
   |-------------|----------------|
   | Local dev | `http://localhost:8080` |
   | GitHub Pages (user site) | `https://yourname.github.io` |
   | GitHub Pages (project site) | `https://yourname.github.io/mikus-drive` |
   | Custom domain | `https://drive.example.com` |

4. **Authorized redirect URIs** — leave empty (this app uses GIS `initTokenClient`, not redirect-based OAuth)
5. Copy the **Client ID** into `js/config.js`

### Step 6 — Security practices

- Use only the **Client ID** in frontend code
- Do **not** commit `client_secret_*.json` or paste client secrets in the repo
- Add `client_secret_*.json` to `.gitignore` if you download credentials
- Rotate credentials if a secret was ever exposed

### What users see on first sign-in

1. Google account picker
2. Consent screen listing Drive + profile permissions
3. After approval, the app stores tokens in `localStorage` for that browser

Users who signed in under an old readonly scope may be prompted to sign in again after you upgrade scopes.

---

## Project structure

```
├── index.html              # Main explorer
├── notepad.html            # Standalone text editor
├── 404.html                # GitHub Pages SPA fallback
├── sw.js                   # Service worker
├── manifest.webmanifest    # PWA manifest
├── css/style.css
├── js/
│   ├── site-config.js      # App name, URLs, Search Console verification
│   ├── config.js           # Client ID, scopes, BASE_PATH
│   ├── base-path.js        # GitHub Pages base path detection
│   ├── register-sw.js      # Service worker registration
│   ├── auth.js             # Multi-user OAuth
│   ├── drive.js            # Drive API
│   ├── router.js           # Path-based URLs
│   ├── notepad.js
│   ├── contextmenu.js
│   └── app.js
└── serve.py                # Local dev server with SPA fallback
```

## URL formats

| Page | Example |
|------|---------|
| Explorer root | `https://user.github.io/mikus-drive/` |
| Folder | `https://user.github.io/mikus-drive/jane.doe/My%20Drive/Work` |
| Notepad | `https://user.github.io/mikus-drive/notepad.html?file=/jane.doe/My%20Drive/notes.txt` |

## Notes

- Full Drive scope allows create, edit, delete, and copy operations
- Shared / Starred / Recent views are flat lists; opening a folder there jumps into the My Drive tree
- Service worker caches static files only; Google API calls always use the network
- On iOS Safari, "Add to Home Screen" uses `manifest.webmanifest` for a standalone-like experience
