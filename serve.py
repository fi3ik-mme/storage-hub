#!/usr/bin/env python3
"""Dev server with SPA fallback so path-based URLs work on refresh."""

import http.server
import os
import sys


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.endswith(('.js', '.css', '.html', '.webmanifest')) or path == '/sw.js':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        file_path = self.translate_path(path)

        if os.path.isdir(file_path):
            index_path = os.path.join(file_path, 'index.html')
            if os.path.isfile(index_path):
                self.path = path.rstrip('/') + '/index.html'
                return super().do_GET()

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            self.path = '/index.html'

        return super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    server = http.server.ThreadingHTTPServer(('', port), SPAHandler)
    print(f'Serving {root} at http://localhost:{port}/')
    print('Path URLs like /misha.mikus/My%20Drive work on refresh.')
    server.serve_forever()


if __name__ == '__main__':
    main()
