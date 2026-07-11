#!/usr/bin/env python3
"""Dev server with SPA fallback so path-based URLs work on refresh."""

import http.server
import json
import os
import sys
import urllib.error
import urllib.request


GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
TOKEN_PROXY_PATH = '/api/github/oauth/token'
GITHUB_SECRET_FILE = '.github_secret'
STATIC_ASSET_SUFFIXES = (
    '.js', '.css', '.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.webmanifest', '.woff', '.woff2', '.map', '.json', '.txt', '.html',
)
STATIC_ASSET_PREFIXES = ('/js/', '/css/', '/assets/')


def is_static_asset_request(path):
    lower = path.lower()
    if lower.endswith(STATIC_ASSET_SUFFIXES):
        return True
    return any(prefix in lower for prefix in STATIC_ASSET_PREFIXES)


def read_github_oauth_credentials(root):
    path = os.path.join(root, GITHUB_SECRET_FILE)
    try:
        with open(path, encoding='utf-8') as handle:
            raw = handle.read().strip()
    except OSError:
        return None, None

    if not raw:
        return None, None

    if raw.startswith('{'):
        try:
            data = json.loads(raw)
            client_id = (data.get('client_id') or '').strip() or None
            client_secret = (data.get('client_secret') or '').strip() or None
            return client_id, client_secret
        except json.JSONDecodeError:
            return None, None

    return None, raw


def read_github_client_secret(root):
    _, client_secret = read_github_oauth_credentials(root)
    return client_secret


def prepare_github_token_request(body_bytes, root):
    try:
        payload = json.loads(body_bytes.decode('utf-8') if body_bytes else '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body_bytes, None

    if payload.get('client_id') == 'reachability-check':
        return body_bytes, None

    if payload.get('client_secret'):
        return body_bytes, None

    client_id_override, secret = read_github_oauth_credentials(root)
    if not secret:
        message = (
            f'Missing GitHub OAuth client secret. '
            f'Add it to {GITHUB_SECRET_FILE} in the project folder.'
        )
        return None, message

    payload['client_secret'] = secret
    if client_id_override:
        payload['client_id'] = client_id_override
    return json.dumps(payload).encode('utf-8'), None


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    project_root = '.'
    def is_local_dev_origin(self, origin):
        if not origin:
            return False
        return origin.startswith('http://localhost:') or origin.startswith('http://127.0.0.1:')

    def send_dev_cors_headers(self):
        origin = self.headers.get('Origin', '')
        if self.is_local_dev_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.endswith(('.js', '.css', '.html', '.webmanifest')) or path == '/sw.js':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        path = self.path.split('?', 1)[0]
        if path == TOKEN_PROXY_PATH:
            self.send_response(204)
            self.send_dev_cors_headers()
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path == TOKEN_PROXY_PATH:
            self.handle_github_token_exchange()
            return
        self.send_error(404)

    def handle_github_token_exchange(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b'{}'
        body, config_error = prepare_github_token_request(body, self.project_root)
        if config_error:
            payload = json.dumps({
                'error': 'misconfigured_proxy',
                'error_description': config_error,
            }).encode()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_dev_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
            return

        req = urllib.request.Request(
            GITHUB_TOKEN_URL,
            data=body,
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'StorageHub-DevServer',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                status = resp.status
        except urllib.error.HTTPError as err:
            data = err.read()
            status = err.code
        except urllib.error.URLError as err:
            payload = json.dumps({'error': 'proxy_error', 'error_description': str(err.reason)}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_dev_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_dev_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        file_path = self.translate_path(path)

        if os.path.isdir(file_path):
            index_path = os.path.join(file_path, 'index.html')
            if os.path.isfile(index_path):
                self.path = path.rstrip('/') + '/index.html'
                return super().do_GET()

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            if is_static_asset_request(path):
                return self.send_error(404)
            self.path = '/index.html'

        return super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    SPAHandler.project_root = root
    server = http.server.ThreadingHTTPServer(('', port), SPAHandler)
    print(f'Serving {root} at http://localhost:{port}/')
    print('Path URLs like /jane.doe/My%20Drive work on refresh.')
    print(f'GitHub OAuth token proxy: http://localhost:{port}{TOKEN_PROXY_PATH}')
    if read_github_client_secret(root):
        print(f'GitHub OAuth client secret: loaded from {GITHUB_SECRET_FILE}')
    else:
        print(f'Warning: {GITHUB_SECRET_FILE} not found — GitHub sign-in token exchange will fail')
    server.serve_forever()


if __name__ == '__main__':
    main()
