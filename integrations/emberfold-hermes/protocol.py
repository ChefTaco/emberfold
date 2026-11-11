import json
import os
import selectors
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 16 * 1024 * 1024


class EmberfoldError(RuntimeError):
    pass


def node_path():
    candidates = list(dict.fromkeys(filter(None, [shutil.which("node"), shutil.which("node", path=os.defpath)])))
    if not candidates:
        raise EmberfoldError("NODE_MISSING: install a supported Node 24 or 26 runtime")
    binary = None
    for candidate in candidates:
        version = subprocess.run([candidate, "--version"], capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        parts = tuple(int(part) for part in version.lstrip("v").split("."))
        if parts[0] == 24 and parts >= (24, 22, 3) or parts[0] == 26 and parts >= (26, 13, 1):
            binary = candidate
            break
    if not binary:
        raise EmberfoldError("NODE_UNSUPPORTED: require ^24.22.3 or ^26.13.1")
    if not (ROOT / "node_modules/@hivemagnus/emberfold/package.json").is_file():
        raise EmberfoldError("DEPENDENCIES_MISSING: run hermes emberfold setup --install-deps")
    if json.loads((ROOT / "node_modules/@hivemagnus/emberfold/package.json").read_text())["version"] != "0.1.0":
        raise EmberfoldError("DEPENDENCY_VERSION_MISMATCH: reinstall the pinned lockfile")
    return binary


def worker(operation, payload, callback, *, provider="hermes", model="configured", timeout=240, cancelled=None, focus=""):
    child = subprocess.Popen(
        [node_path(), str(ROOT / "bridge/worker.js")], cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={key: value for key, value in os.environ.items() if key in {"PATH", "SYSTEMROOT", "WINDIR", "TMPDIR"}},
    )
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    started = time.monotonic()
    pending = b""
    received = 0

    def send(value):
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(encoded) > MAX_BYTES:
            raise EmberfoldError("PROTOCOL_LIMIT: input exceeds 16 MiB")
        child.stdin.write(encoded)
        child.stdin.flush()

    try:
        send({"version": 1, "operation": operation, "payload": payload,
              "provider": provider, "model": model, "timeout_ms": int(timeout * 1000), "focus": focus})
        expected_id = 1
        while time.monotonic() - started < timeout:
            if cancelled and cancelled():
                raise EmberfoldError("COMPACTION_CANCELLED")
            if not selector.select(0.1):
                continue
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                raise EmberfoldError("WORKER_EXITED: no complete result")
            received += len(chunk)
            pending += chunk
            if len(pending) > MAX_BYTES or received > MAX_BYTES * 64:
                raise EmberfoldError("PROTOCOL_LIMIT")
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                message = json.loads(line)
                if message.get("version") != 1:
                    raise EmberfoldError("PROTOCOL_VERSION")
                if "error" in message:
                    raise EmberfoldError(message["error"])
                if "method" not in message:
                    if set(message) != {"version", "result"}:
                        raise EmberfoldError("PROTOCOL_RESULT")
                    return message["result"]
                if message.get("id") != expected_id or expected_id > 4096 or message["method"] not in {"count", "summarize"}:
                    raise EmberfoldError("PROTOCOL_CALLBACK")
                result = callback(message["method"], message["params"])
                if time.monotonic() - started >= timeout or cancelled and cancelled():
                    raise EmberfoldError("COMPACTION_CANCELLED")
                send({"version": 1, "id": expected_id, "result": result})
                expected_id += 1
        raise EmberfoldError("COMPACTION_TIMEOUT")
    finally:
        selector.close()
        child.stdin.close()
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=2)
        child.stdout.close()
