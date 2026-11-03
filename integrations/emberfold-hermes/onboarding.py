import copy
import hashlib
import inspect
import json
import shutil
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

from .engine import (EmberfoldEngine, PLUGIN, TASK, auxiliary_route, canonical, checkpoint_in,
                     data_path, digest, home_path, load_protections, measured_tokens, namespace_for, normalize, private_json,
                     process_start, read_config, settings_from)
from .protocol import EmberfoldError, ROOT, node_path


def configure_parser(parser):
    commands = parser.add_subparsers(dest="emberfold_command", required=True)
    for name in ("setup", "doctor", "status", "rollback", "inspect", "recall", "protect", "rebuild"):
        command = commands.add_parser(name)
        command.add_argument("--json", action="store_true")
        if name in {"setup", "rollback"}:
            command.add_argument("--yes", action="store_true", help="Approve displayed configuration changes and synthetic model check")
            command.add_argument("--restart", action="store_true", help="Also consent to restarting this profile's Hermes gateway")
        if name == "setup":
            command.add_argument("--check", action="store_true", help="Read-only: no model call, installation, or configuration write")
            command.add_argument("--install-deps", action="store_true", help="Consent to npm ci in this plugin only")
            command.add_argument("--profile", choices=("general", "creative", "reflective"), default="general")
        if name in {"inspect", "recall", "protect", "rebuild"}:
            command.add_argument("--session", required=True)
        if name == "recall":
            command.add_argument("--message-id", action="append", required=True)
        if name == "protect":
            command.add_argument("--message-id", required=True)
            command.add_argument("--start", type=int, required=True, help="UTF-16 code-unit offset")
            command.add_argument("--end", type=int, required=True, help="UTF-16 code-unit offset")
        if name == "rebuild":
            command.add_argument("--apply", action="store_true", help="Queue rebuild for the next host-owned /compress commit")
            command.add_argument("--expected-head")


def _emit(value, json_output=False):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _confirm(prompt, approved=False):
    if approved:
        return True
    if not sys.stdin.isatty():
        raise EmberfoldError("CONSENT_REQUIRED: use --yes after reviewing setup --check")
    print(prompt + " [y/N]: ", end="", file=sys.stderr, flush=True)
    return input().strip().lower() in {"y", "yes"}


def preflight(ctx):
    from agent.context_engine import ContextEngine
    config = read_config()
    required = ("register_context_engine", "register_auxiliary_task", "register_cli_command", "register_hook", "register_middleware")
    errors = []
    if any(not callable(getattr(ctx, name, None)) for name in required) or not hasattr(ctx, "llm"):
        errors.append("HERMES_UNSUPPORTED: upgrade Hermes to support context engines and host-owned plugin LLMs")
    if "force" not in inspect.signature(ContextEngine.compress).parameters:
        errors.append("HERMES_UNSUPPORTED: manual compaction contract is missing")
    try:
        binary = node_path()
    except Exception as error:
        binary = None
        errors.append(str(error))
    route = auxiliary_route(config)
    if route["api_mode"] == "codex_app_server" or config.get("model", {}).get("api_mode") == "codex_app_server":
        errors.append("RUNTIME_UNSUPPORTED: external app-server owns its backing context")
    settings = settings_from(config)
    return {"version": 1, "installed": True, "configured": config.get("context", {}).get("engine") == "emberfold",
            "home": str(home_path()), "node": binary, "route": display_route(route), "settings": settings,
            "previous_engine": config.get("context", {}).get("engine", "compressor"), "errors": errors,
            "memory_provider_unchanged": config.get("memory", {}).get("provider", "builtin")}


def display_route(route):
    result = dict(route)
    try:
        parsed = urllib.parse.urlsplit(route["base_url"])
        hostname = parsed.hostname or ""
        if ":" in hostname:
            hostname = "[" + hostname + "]"
        result["base_url"] = urllib.parse.urlunsplit((parsed.scheme, hostname + (":" + str(parsed.port) if parsed.port else ""), "", "", ""))
    except ValueError:
        result["base_url"] = "invalid URL (redacted)"
    return result


def status(ctx):
    result = preflight(ctx)
    proof_path = home_path() / "plugin-data" / PLUGIN / "runtime.json"
    proof = None
    if proof_path.exists():
        try:
            proof = json.loads(proof_path.read_text())
        except (ValueError, OSError):
            result["errors"].append("INDEX_CORRUPT: restart a session to recover from its committed handoff")
    active = bool(proof and proof.get("process_start") and
                  proof["process_start"] == process_start(proof.get("pid")) and proof.get("engine") == "emberfold" and
                  time.time() - proof.get("observed_at", 0) < 3600)
    result.update({"active": active, "healthy": result["configured"] and active and not result["errors"] and not proof.get("last_error"),
                   "runtime": proof, "activation_note": "Requires a real session in the current running Hermes process"})
    return result


def synthetic_check(ctx, config):
    temporary_config = copy.deepcopy(config)
    settings = temporary_config.setdefault("plugins", {}).setdefault("entries", {}).setdefault(PLUGIN, {}).setdefault("settings", {})
    settings.update({"protect_first_n": 0, "protect_last_n": 0, "recent_exchanges": 2})
    engine = EmberfoldEngine(ctx.llm, temporary_config)
    engine.session_id = "synthetic-onboarding"
    engine.namespace = "synthetic-onboarding"
    engine.context_length = 32000
    messages = [{"role": "system", "content": "Synthetic onboarding test. Do not call tools."}]
    for index in range(10):
        messages.extend([
            {"message_uid": f"synthetic-user-{index}", "role": "user", "content": f"Synthetic task {index}: retain the identifier PROJECT-{index}. The external action outcome is unknown. " * 5},
            {"message_uid": f"synthetic-assistant-{index}", "role": "assistant", "content": f"Reported constraint for PROJECT-{index}. Keep work unresolved; no external action was attempted. " * 5},
        ])
    output = engine.compress(messages, force=True)
    checkpoint = checkpoint_in(output)
    if not checkpoint or not engine.last_result or engine.last_result["generation"] != 1:
        raise EmberfoldError("SELF_TEST_FAILED: no validated compaction candidate")
    return {"passed": True, "model_calls": True, "tools_disabled": True, "result": engine.last_result}


def _save_patch(changes):
    from hermes_cli import config as config_module
    from hermes_cli import managed_scope
    if config_module.is_managed():
        raise EmberfoldError("CONFIGURATION_MANAGED: request administrator activation")
    for path in changes:
        if managed_scope.is_key_managed(".".join(path)):
            raise EmberfoldError("CONFIGURATION_MANAGED: requested key is administrator-owned")
    raw = config_module.read_user_config_raw()
    for path, value in changes.items():
        cursor = raw
        for segment in path[:-1]:
            cursor = cursor.setdefault(segment, {})
        if value == {"emberfold_missing": True}:
            cursor.pop(path[-1], None)
        else:
            cursor[path[-1]] = copy.deepcopy(value)
    config_module.save_config(raw, strip_defaults=False)


def _value(config, path):
    cursor = config
    for segment in path:
        if not isinstance(cursor, dict) or segment not in cursor:
            return {"emberfold_missing": True}
        cursor = cursor[segment]
    return copy.deepcopy(cursor)


def _restart():
    if home_path() != Path.home().joinpath(".hermes").resolve():
        raise EmberfoldError("RESTART_SCOPE_UNVERIFIED: restart this profile through its existing supervisor")
    subprocess.run(["systemctl", "--user", "restart", "hermes-gateway.service"], check=True, timeout=60)


def setup(args, ctx):
    before = preflight(ctx)
    if args.check:
        return before
    if args.install_deps:
        npm = shutil.which("npm")
        if not npm:
            raise EmberfoldError("NPM_MISSING")
        subprocess.run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=ROOT, check=True, timeout=180,
                       stdout=sys.stderr, stderr=sys.stderr)
        before = preflight(ctx)
    if before["errors"]:
        raise EmberfoldError("PREFLIGHT_FAILED: " + "; ".join(before["errors"]))
    proposal = {"proposal": {"engine": "emberfold", "profile": args.profile, "home": before["home"], "route": before["route"],
                        "settings": before["settings"], "memory_provider": "unchanged", "fallback": "preserve-and-report",
                        "model_check": "synthetic history only", "restart": bool(args.restart)}}
    print(json.dumps(proposal, indent=2), file=sys.stderr if args.json else sys.stdout)
    if not _confirm("Run the synthetic model check and configure Emberfold for this home?", args.yes):
        return {"configured": False, "changed": False}
    config = read_config()
    settings = settings_from(config)
    settings["profile"] = args.profile
    route = auxiliary_route(config)
    if not settings.get("tokenizer_url") and route["base_url"]:
        parsed = urllib.parse.urlsplit(route["base_url"])
        if parsed.scheme in {"http", "https"} and not parsed.username and not parsed.password:
            base = route["base_url"].rstrip("/")
            if base.endswith("/v1"):
                base = base[:-3]
            try:
                measured_tokens(base, [{"role": "user", "content": "Synthetic tokenizer check"}], [])
                settings["tokenizer_url"] = base
            except Exception:
                pass
    changes = {("context", "engine"): "emberfold", ("compression", "abort_on_summary_failure"): True,
               ("plugins", "entries", PLUGIN, "settings"): settings,
               ("auxiliary", TASK, "fallback_chain"): []}
    candidate = copy.deepcopy(config)
    candidate.setdefault("plugins", {}).setdefault("entries", {}).setdefault(PLUGIN, {})["settings"] = settings
    check = synthetic_check(ctx, candidate)
    root = data_path()
    rollback_path = root / "setup-rollback.json"
    if not rollback_path.exists():
        private_json(rollback_path, {"version": 1, "home": str(home_path()), "keys": [
            {"path": list(path), "before": _value(config, path), "applied": value} for path, value in changes.items()]})
    elif not before["configured"]:
        raise EmberfoldError("ROLLBACK_RECORD_EXISTS: inspect the previous setup before configuring again")
    if read_config() != config:
        raise EmberfoldError("CONFIGURATION_CHANGED: rerun setup")
    _save_patch(changes)
    if args.restart:
        _restart()
    return {"configured": True, "active": False, "self_test": check, "restart_requested": args.restart,
            "next": "Start a Hermes session, then run hermes emberfold status"}


def rollback(args):
    path = data_path() / "setup-rollback.json"
    record = json.loads(path.read_text())
    if record.get("home") != str(home_path()):
        raise EmberfoldError("ROLLBACK_SCOPE_MISMATCH")
    config = read_config()
    changes = {}
    for row in record["keys"]:
        key = tuple(row["path"])
        if _value(config, key) != row["applied"]:
            raise EmberfoldError("ROLLBACK_CONFIG_CHANGED: refusing to overwrite newer settings")
        changes[key] = row["before"]
    if not _confirm("Restore only the previous Emberfold-related configuration? History and credentials remain intact.", args.yes):
        return {"changed": False}
    _save_patch(changes)
    path.rename(path.with_name("setup-rollback-" + str(time.time_ns()) + ".json"))
    if args.restart:
        _restart()
    return {"rolled_back": True, "history_preserved": True, "restart_requested": args.restart}


def session_command(args, ctx):
    from hermes_state import SessionDB
    database = SessionDB(read_only=True)
    try:
        engine = EmberfoldEngine(ctx.llm)
        engine.bind_session_state(database, args.session)
        active = engine._originals(False)
        checkpoint = checkpoint_in(active)
        engine.namespace = namespace_for(database, args.session, engine.home)
        if not checkpoint and args.emberfold_command == "inspect":
            return {"checkpoint": None, "sources": [{"id": message.get("message_uid"), "role": message["role"]}
                    for message in active if message.get("message_uid")]}
        if not checkpoint and args.emberfold_command != "protect":
            raise EmberfoldError("CHECKPOINT_UNAVAILABLE")
        if checkpoint and checkpoint["namespace"] != engine.namespace:
            raise EmberfoldError("CHECKPOINT_SCOPE_MISMATCH")
        if checkpoint:
            sources = engine._covered_sources(checkpoint, active)
            engine._run("validate", {"checkpoint": checkpoint, "history": sources, "namespace": engine.namespace})
        else:
            sources = [normalize(message) for message in active if message.get("message_uid") and message["role"] != "system"]
        if args.emberfold_command == "inspect":
            return {"checkpoint": checkpoint, "validation": "passed", "originals": "retained"}
        if args.emberfold_command == "recall":
            return json.loads(engine.handle_tool_call("emberfold_recall", {"message_ids": args.message_id}))
        if args.emberfold_command == "rebuild":
            if not args.apply:
                return {"dry_run": True, "model_calls": False, "source_messages": len(sources), "head": checkpoint["id"],
                        "next": "Use --apply --expected-head HEAD, then /compress in the same session"}
            if args.expected_head != checkpoint["id"]:
                raise EmberfoldError("REBUILD_HEAD_MISMATCH")
            if checkpoint:
                private_json(data_path() / (digest(engine.namespace) + ".rebuild.json"), {
                    "version": 1, "expected_head": checkpoint["id"], "settings_sha256": digest(engine.settings)})
            return {"queued": True, "published": False, "next": "Run /compress in this session; Hermes owns the commit"}
        if args.emberfold_command == "protect":
            if database.get_compression_lock_holder(args.session):
                raise EmberfoldError("COMPACTION_IN_PROGRESS: retry after the host commit")
            source = next((message for message in sources if message["id"] == args.message_id), None)
            if not source or not isinstance(source.get("content"), str) or args.start < 0 or args.end <= args.start:
                raise EmberfoldError("PROTECTION_INVALID")
            encoded = source["content"].encode("utf-16-le")
            if args.end * 2 > len(encoded):
                raise EmberfoldError("PROTECTION_INVALID")
            text = encoded[args.start * 2:args.end * 2].decode("utf-16-le")
            span = {"message_id": source["id"], "source_sha256": hashlib.sha256(source["content"].encode()).hexdigest(),
                    "start": args.start, "end": args.end, "text": text}
            spans = load_protections(engine.home, engine.namespace)
            if span not in spans:
                spans.append(span)
            private_json(data_path() / (digest(engine.namespace) + ".protected.json"), spans)
            if checkpoint:
                private_json(data_path() / (digest(engine.namespace) + ".rebuild.json"), {
                    "version": 1, "expected_head": checkpoint["id"], "settings_sha256": digest(engine.settings)})
            return {"queued": True, "published": False, "source_id": source["id"], "next": "Run /compress to publish the protected handoff"}
        raise EmberfoldError("COMMAND_INVALID")
    finally:
        database.close()


def handle_cli(args, ctx):
    try:
        name = args.emberfold_command
        if name in {"doctor", "status"}:
            result = status(ctx)
        elif name == "setup":
            result = setup(args, ctx)
        elif name == "rollback":
            result = rollback(args)
        else:
            result = session_command(args, ctx)
        _emit(result, args.json)
        return 0
    except Exception as error:
        print(canonical({"error": str(error).split(":", 1)[0], "detail": str(error) if isinstance(error, EmberfoldError) else "Operation failed; history was not replaced"}), file=sys.stderr)
        return 2
