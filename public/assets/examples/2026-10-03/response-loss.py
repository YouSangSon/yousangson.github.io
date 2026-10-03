"""Educational loopback-only HTTP experiment; no external service is called."""

import json
import re
import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def run_demo():
    entered, release, committed = Event(), Event(), Event()
    with tempfile.TemporaryDirectory(prefix="response-loss-") as directory:
        database = Path(directory) / "demo.sqlite"
        with closing(sqlite3.connect(database)) as db:
            db.executescript("""
                CREATE TABLE counter (id INTEGER PRIMARY KEY, total INTEGER NOT NULL);
                INSERT INTO counter VALUES (1, 0);
                CREATE TABLE receipt (
                    operation TEXT PRIMARY KEY, amount INTEGER NOT NULL, result INTEGER NOT NULL
                );
            """)

        def total():
            with closing(sqlite3.connect(database)) as db:
                return db.execute("SELECT total FROM counter WHERE id=1").fetchone()[0]

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, value):
                body = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if not self.path.startswith("/operations/"):
                    self.reply(404, {"error": "not found"})
                    return
                operation = self.path.removeprefix("/operations/")
                with closing(sqlite3.connect(database)) as db:
                    row = db.execute(
                        "SELECT result FROM receipt WHERE operation=?", (operation,)
                    ).fetchone()
                self.reply(200, {"state": "completed", "result": row[0]} if row
                           else {"state": "unknown"})

            def do_POST(self):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if self.path != "/commands" or not 0 < length <= 256:
                        raise ValueError("invalid request")
                    operation = self.headers.get("Idempotency-Key", "")
                    if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", operation):
                        raise ValueError("invalid operation")
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict) or set(payload) != {"amount"}:
                        raise ValueError("invalid payload")
                    amount = payload["amount"]
                    if type(amount) is not int or amount not in (1, 2):
                        raise ValueError("invalid amount")
                except (ValueError, TypeError):
                    self.reply(400, {"error": "invalid request"})
                    return
                if self.headers.get("X-Demo-Gate") == "hold":
                    entered.set()
                    if not release.wait(10):
                        self.reply(503, {"error": "demo gate expired"})
                        return
                with closing(sqlite3.connect(database)) as db:
                    db.execute("BEGIN IMMEDIATE")
                    row = db.execute(
                        "SELECT amount, result FROM receipt WHERE operation=?", (operation,)
                    ).fetchone()
                    if row:
                        db.rollback()
                        if row[0] != amount:
                            self.reply(409, {"error": "same key, different payload"})
                            return
                        result = row[1]
                    else:
                        db.execute("UPDATE counter SET total=total+? WHERE id=1", (amount,))
                        result = db.execute("SELECT total FROM counter WHERE id=1").fetchone()[0]
                        db.execute("INSERT INTO receipt VALUES (?, ?, ?)",
                                   (operation, amount, result))
                        db.commit()
                if operation == "late-a":
                    committed.set()
                if self.headers.get("X-Demo-Response") == "drop":
                    self.close_connection = True
                    return
                self.reply(200, {"state": "completed", "result": result})

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = False
        worker = Thread(target=server.serve_forever)
        worker.start()
        origin = f"http://127.0.0.1:{server.server_port}"

        def request(operation, *, amount=1, lookup=False, timeout=5, **headers):
            path = f"/operations/{operation}" if lookup else "/commands"
            body = None if lookup else json.dumps({"amount": amount}).encode()
            req = Request(origin + path, data=body,
                          headers={"Idempotency-Key": operation, **headers})
            try:
                with urlopen(req, timeout=timeout) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                with error:
                    return error.code, json.load(error)
            except (RemoteDisconnected, TimeoutError):
                return None, {"state": "unknown"}

        try:
            assert request("wrong-a", **{"X-Demo-Response": "drop"})[0] is None
            assert request("wrong-b")[0] == 200
            assert total() == 2
            print("new key after lost response: total=2")

            before = total()
            assert request("safe-a", **{"X-Demo-Response": "drop"})[0] is None
            receipt = request("safe-a", lookup=True)
            assert receipt == request("safe-a") == request("safe-a")
            assert total() - before == 1
            print("same key after lost response: delta=1; receipt replayed")
            assert request("safe-a", amount=2)[0] == 409
            assert total() - before == 1
            print("same key with changed payload: HTTP 409; delta=1")

            before = total()
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(request, "late-a", timeout=0.2,
                                      **{"X-Demo-Gate": "hold", "X-Demo-Response": "drop"})
                try:
                    assert entered.wait(3), "server did not enter the demo gate"
                    assert pending.result(timeout=3) == (None, {"state": "unknown"})
                    assert request("late-a", lookup=True) == (200, {"state": "unknown"})
                    assert total() == before
                    print("client timeout, lookup before commit: unknown")
                finally:
                    release.set()
                assert committed.wait(3), "server did not commit after client timeout"
            assert request("late-a", lookup=True)[1]["state"] == "completed"
            assert total() - before == 1
            print("same request after release: completed; delta=1")
        finally:
            release.set()
            server.shutdown()
            worker.join(timeout=5)
            server.server_close()
            assert not worker.is_alive(), "server worker did not stop"


if __name__ == "__main__":
    run_demo()
