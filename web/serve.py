"""Static development server with consistent ES-module and WASM MIME types."""
import http.server
import sys


class WebHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }


if __name__ == "__main__":
    http.server.test(
        HandlerClass=WebHandler,
        ServerClass=http.server.ThreadingHTTPServer,
        port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000,
        bind="127.0.0.1",
    )
