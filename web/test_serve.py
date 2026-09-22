"""Check the responses used by browser imports, independent of Windows MIME settings."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import Request, urlopen

from serve import WebHandler


with ThreadingHTTPServer(("127.0.0.1", 0), partial(
    WebHandler, directory=str(Path(__file__).parent)
)) as server:
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for name, mime in (
            ("asm6502.mjs", "text/javascript"),
            ("challenge-copy.js", "text/javascript"),
            ("badger6502.wasm", "application/wasm"),
        ):
            request = Request(f"http://127.0.0.1:{server.server_port}/{name}", method="HEAD")
            with urlopen(request, timeout=5) as response:
                assert response.status == 200
                assert response.headers.get_content_type() == mime, (name, response.headers)
        print("PASS development server ES-module and WASM MIME types")
    finally:
        server.shutdown()
        thread.join()
