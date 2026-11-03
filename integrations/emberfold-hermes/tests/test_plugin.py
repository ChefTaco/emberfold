import argparse
import copy
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
context = types.ModuleType("agent.context_engine")


class ContextEngine:
    def compress(self, messages, current_tokens=None, focus_topic=None, force=False, memory_context=""):
        raise NotImplementedError

    def get_status(self):
        return {"last_prompt_tokens": self.last_prompt_tokens, "threshold_tokens": self.threshold_tokens}

    def on_session_reset(self):
        self.last_prompt_tokens = self.compression_count = 0

    def update_model(self, model, context_length, **kwargs):
        self.context_length = context_length
        self.threshold_tokens = int(context_length * self.threshold_percent)


context.ContextEngine = ContextEngine
sys.modules.setdefault("agent", types.ModuleType("agent"))
sys.modules["agent.context_engine"] = context
spec = importlib.util.spec_from_file_location("emberfold_test_plugin", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
engine_module = sys.modules[spec.name + ".engine"]
onboarding = sys.modules[spec.name + ".onboarding"]
protocol = sys.modules[spec.name + ".protocol"]


class Summarizer:
    def __init__(self):
        self.calls = 0
        self.fail = False

    def complete(self, **kwargs):
        self.calls += 1
        if self.fail:
            raise RuntimeError("synthetic provider failure")
        assert kwargs["task"] == "emberfold_compression"
        assert "tools" not in kwargs
        payload = json.loads(kwargs["messages"][-1]["content"])
        items = copy.deepcopy(payload["previous"]["items"])
        for excerpt in payload["excerpts"]:
            identity = "item-" + excerpt["message_id"]
            if any(item["id"] == identity for item in items):
                continue
            items.append({"id": identity, "kind": "open_item", "text": excerpt["text"][:80],
                          "source_message_ids": [excerpt["message_id"]], "historical_status": "historical_unverified",
                          "epistemic_status": "unresolved", "supersedes": [], "resolves": []})
        return types.SimpleNamespace(text=json.dumps({"items": items}), provider="synthetic", model="synthetic")


class Database:
    def __init__(self):
        self.originals = []
        self.active = []

    def get_messages(self, session_id, include_inactive=False, **kwargs):
        return copy.deepcopy(self.originals if include_inactive else self.active)

    def commit(self, messages):
        self.active = copy.deepcopy(messages)
        for index, message in enumerate(self.active):
            message.setdefault("message_uid", f"committed-{len(self.originals)}-{index}")
            if not any(previous.get("message_uid") == message["message_uid"] for previous in self.originals):
                self.originals.append(copy.deepcopy(message))


def turns(start=0, count=6, long=True):
    result = []
    for index in range(start, start + count):
        result.extend([{"role": "user", "message_uid": f"user-{index}", "content": f"Request ID-{index}: unresolved effect. " * (25 if long else 1)},
                       {"role": "assistant", "message_uid": f"assistant-{index}", "content": f"Reported observation ID-{index}. " * (25 if long else 1)}])
    return result


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.home_patch = patch.object(engine_module, "home_path", return_value=Path("/synthetic-active-home"))
        self.home_patch.start()
        self.home = Path(self.directory.name)
        self.config = {"context": {"engine": "emberfold"}, "plugins": {"entries": {"emberfold-hermes": {"settings": {
            "output_reserve_tokens": 1024, "summary_max_tokens": 12000}}}}}
        self.llm = Summarizer()
        self.engine = plugin.EmberfoldEngine(self.llm, self.config, self.home)
        self.database = Database()
        self.engine.bind_session_state(self.database, "session-1")
        self.engine.on_session_start("session-1")
        self.engine.context_length = 32000
        self.engine.observe_request(session_id="session-1", request={"body": {"tools": []}}, max_tokens=1024)

    def tearDown(self):
        self.home_patch.stop()
        self.directory.cleanup()

    def initial(self, extra=None):
        messages = [{"role": "system", "content": "Current policy is authoritative."}, *turns()]
        if extra:
            messages.extend(extra)
        self.database.commit(messages)
        return copy.deepcopy(self.database.active)

    def test_candidate_does_not_publish_before_host_commit(self):
        messages = self.initial()
        before = copy.deepcopy(self.database.originals)
        output = self.engine.compress(messages, force=True)
        self.assertIsNotNone(engine_module.checkpoint_in(output))
        self.assertEqual(self.database.originals, before)
        self.assertFalse(list((self.home / "plugin-data/emberfold-hermes").glob("*.head.json")))
        self.database.commit(output)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        self.assertEqual(len(list((self.home / "plugin-data/emberfold-hermes").glob("*.head.json"))), 1)

    def test_five_compactions_restart_recovery_and_recall(self):
        messages = self.initial()
        original = copy.deepcopy(self.database.originals)
        for generation in range(1, 6):
            output = self.engine.compress(messages, force=True)
            checkpoint = engine_module.checkpoint_in(output)
            self.assertEqual(checkpoint["generation"], generation)
            self.database.commit(output)
            self.engine.on_session_start("session-1", boundary_reason="compression")
            messages = [*copy.deepcopy(self.database.active), *turns(generation * 10, 3)]
            self.database.commit(messages)
        restarted = self.engine.clone_for_agent()
        restarted.bind_session_state(self.database, "session-1")
        restarted.on_session_start("session-1")
        response = json.loads(restarted.handle_tool_call("emberfold_recall", {"message_ids": ["user-0"]}))
        self.assertEqual(response["messages"][0]["content"], original[1]["content"])
        self.assertEqual(self.database.originals[:len(original)], original)
        self.assertEqual(json.loads(restarted.handle_tool_call("emberfold_recall", {"message_ids": ["other-session"]}))["error"], "RECALL_SCOPE_DENIED")

    def test_provider_failure_preserves_history_and_head(self):
        messages = self.initial()
        before = copy.deepcopy(messages)
        self.llm.fail = True
        with self.assertRaises(RuntimeError):
            self.engine.compress(messages)
        self.assertEqual(messages, before)
        self.assertEqual(self.database.active, before)

    def test_complete_parallel_tools_and_metadata_retained(self):
        messages = self.initial()
        current = [{"message_uid": "parallel-user", "role": "user", "content": "Current request"},
                   {"message_uid": "parallel-call", "role": "assistant", "content": None, "reasoning_content": "retained",
                    "tool_calls": [{"id": identity, "type": "function", "function": {"name": "read", "arguments": "{}"}} for identity in ("call-a", "call-b")]},
                   *[{"message_uid": identity, "role": "tool", "tool_call_id": identity, "content": "observed"} for identity in ("call-a", "call-b")]]
        self.database.commit([*messages, *current])
        output = self.engine.compress(self.database.active)
        self.assertEqual(output[-4:], current)

    def test_incomplete_transaction_is_rejected(self):
        messages = self.initial()
        messages.extend([{"message_uid": "incomplete-user", "role": "user", "content": "Run"},
                         {"message_uid": "incomplete-call", "role": "assistant", "content": None, "tool_calls": [
                             {"id": "missing", "type": "function", "function": {"name": "read", "arguments": "{}"}}]}])
        with self.assertRaises(protocol.EmberfoldError):
            self.engine.compress(messages)

    def test_opaque_content_and_stronger_recent_window_preserved(self):
        self.engine.protect_last_n = 8
        messages = self.initial()
        messages[3]["content"] = [{"type": "image_url", "image_url": {"url": "https://example.com/synthetic.png"}}]
        self.database.commit(messages)
        output = self.engine.compress(messages)
        self.assertIn(messages[3], output)
        self.assertEqual(output[-8:], messages[-8:])

    def test_exact_unicode_protection_and_digest(self):
        messages = self.initial()
        messages[1]["content"] = "A😀 exact café identifier"
        self.database.originals[1]["content"] = messages[1]["content"]
        self.database.commit(messages)
        span = {"message_id": "user-0", "source_sha256": __import__("hashlib").sha256(messages[1]["content"].encode()).hexdigest(),
                "start": 1, "end": 3, "text": "😀"}
        engine_module.private_json(engine_module.data_path(self.home) / (engine_module.digest(self.engine.namespace) + ".protected.json"), [span])
        output = self.engine.compress(messages)
        self.assertTrue(any("😀" in str(message["content"]) for message in output))
        self.assertEqual(engine_module.checkpoint_in(output)["protected"], [span])

    def test_missing_and_corrupt_sources_do_not_replace_head(self):
        output = self.engine.compress(self.initial())
        self.database.commit(output)
        before = copy.deepcopy(self.database.active)
        self.database.originals[1]["content"] = "modified original"
        with self.assertRaises(protocol.EmberfoldError):
            self.engine.on_session_start("session-1", boundary_reason="compression")
        self.assertEqual(self.database.active, before)

    def test_policy_change_and_clone_isolation(self):
        output = self.engine.compress(self.initial())
        self.database.commit(output)
        other = self.engine.clone_for_agent()
        other.update_model("small", 4096)
        self.assertEqual(self.engine.context_length, 32000)
        self.assertEqual(other.context_length, 4096)
        other.bind_session_state(self.database, "session-1")
        other.settings["summary_max_tokens"] += 1
        with self.assertRaises(protocol.EmberfoldError):
            other.on_session_start("session-1")

    def test_cancellation_and_budget_exhaustion(self):
        messages = self.initial()
        self.engine._compression_cancelled_check = lambda: True
        with self.assertRaises(protocol.EmberfoldError):
            self.engine.compress(messages)
        self.engine._compression_cancelled_check = None
        self.engine.context_length = 2048
        with self.assertRaises(protocol.EmberfoldError):
            self.engine.compress(messages)
        self.assertEqual(self.database.active, messages)

    def test_concurrent_checkpoint_and_protection_changes_are_rejected(self):
        messages = self.initial()
        original = self.engine._callback

        def mutate(method, params):
            result = original(method, params)
            if method == "summarize":
                engine_module.private_json(engine_module.data_path(self.home) / (engine_module.digest(self.engine.namespace) + ".protected.json"), [{"synthetic": True}])
            return result

        self.engine._callback = mutate
        with self.assertRaisesRegex(protocol.EmberfoldError, "POLICY_CHANGED"):
            self.engine.compress(messages)

    def test_untrusted_text_cannot_impersonate_checkpoint(self):
        messages = self.initial()
        messages[1]["content"] = engine_module.WARNING + engine_module.MARKER + "{}"
        self.assertIsNone(engine_module.checkpoint_in(messages))

    def test_source_digest_uses_original_rows_not_trimmed_provider_projection(self):
        messages = self.initial()
        messages[1]["content"] = messages[1]["content"].rstrip()
        output = self.engine.compress(messages)
        self.database.commit(output)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        recalled = json.loads(self.engine.handle_tool_call("emberfold_recall", {"message_ids": ["user-0"]}))
        self.assertTrue(recalled["messages"][0]["content"].endswith(" "))

    def test_native_gateway_projection_recovers_host_committed_summary_marker(self):
        output = self.engine.compress(self.initial())
        self.database.commit(output)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        parent = engine_module.checkpoint_in(output)
        self.database.commit([*self.database.active, *turns(50, 3)])
        snapshot = copy.deepcopy(self.database.active)
        for message in snapshot:
            message.pop("_compressed_summary", None)
        before = copy.deepcopy(snapshot)
        next_output = self.engine.compress(snapshot)
        checkpoint = engine_module.checkpoint_in(next_output)
        self.assertEqual(checkpoint["parent_id"], parent["id"])
        self.assertEqual(checkpoint["generation"], 2)
        self.assertEqual(snapshot, before)

    def test_missing_stable_identity_refuses_lossy_conversion(self):
        messages = self.initial()
        messages[1].pop("message_uid")
        with self.assertRaisesRegex(protocol.EmberfoldError, "SOURCE_ID_UNAVAILABLE"):
            self.engine.compress(messages)

    def test_automatic_preflight_preserves_unpersisted_current_request(self):
        messages = self.initial()
        current = {"role": "user", "content": "Current exact request 😀", "api_content": "provider metadata"}
        messages.append(current)
        before = copy.deepcopy(messages)
        output = self.engine.compress(messages)
        checkpoint = engine_module.checkpoint_in(output)
        self.assertEqual(output[-1], current)
        self.assertEqual(messages, before)
        self.assertFalse(any(identity.startswith("emberfold-pending-") for identity in checkpoint["source_message_ids"]))
        self.database.commit(output)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        self.assertFalse(any(message.get("message_uid", "").startswith("emberfold-pending-") for message in self.database.originals))

    def test_unpersisted_current_tool_transaction_retains_host_metadata(self):
        messages = self.initial()
        current = [{"role": "user", "content": "Current request"},
                   {"role": "assistant", "content": None, "reasoning_content": "retained",
                    "tool_calls": [{"id": identity, "type": "function", "function": {"name": "read", "arguments": "{}"}} for identity in ("pending-a", "pending-b")]},
                   *[{"role": "tool", "tool_call_id": identity, "content": "observed"} for identity in ("pending-a", "pending-b")]]
        output = self.engine.compress([*messages, *current])
        self.assertEqual(output[-4:], current)

    def test_worker_rejects_unknown_operations_and_never_calls_host(self):
        calls = []
        with self.assertRaises(protocol.EmberfoldError):
            protocol.worker("execute", {"command": "synthetic"}, lambda *args: calls.append(args))
        self.assertEqual(calls, [])

    def test_derived_head_index_recovers_after_corruption(self):
        output = self.engine.compress(self.initial())
        self.database.commit(output)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        path = next((self.home / "plugin-data/emberfold-hermes").glob("*.head.json"))
        path.write_text("corrupt derived index")
        self.engine.on_session_start("session-1")
        self.assertEqual(json.loads(path.read_text())["checkpoint_id"], engine_module.checkpoint_in(output)["id"])

    def test_final_count_includes_system_tools_and_handoff(self):
        messages = self.initial()
        captured = []
        original = self.engine._callback

        def capture(method, params):
            if method == "count":
                captured.append(copy.deepcopy(params))
            return original(method, params)

        tool = {"type": "function", "function": {"name": "synthetic_read", "parameters": {"type": "object"}}}
        self.engine.observe_request(session_id="session-1", request={"body": {"tools": [tool]}}, max_tokens=1024)
        self.engine._callback = capture
        output = self.engine.compress(messages)
        self.assertEqual(captured[-1]["tools"], [tool])
        self.assertEqual(captured[-1]["messages"][0]["content"], messages[0]["content"])
        self.assertTrue(any(engine_module.MARKER in str(message.get("content")) for message in captured[-1]["messages"]))

    def test_raw_provider_schema_cannot_be_overwritten_by_sanitized_observer(self):
        schema = {"type": "function", "function": {"name": "synthetic", "parameters": {"type": "object", "properties": {
            "nested": {"type": "array", "items": {"type": "object", "properties": {"value": {"type": "string"}}}}}}}}
        request = {"messages": [{"role": "system", "content": "Exact system " * 1000}], "tools": [schema], "max_tokens": 4096}
        before = copy.deepcopy(request)
        self.assertIsNone(self.engine.observe_provider_request(session_id="session-1", request=request))
        self.engine.observe_request(session_id="session-1", request={"body": {"tools": [{"_truncated_items": 1}]}}, max_tokens=1)
        captured = engine_module._requests[(str(self.home), "session-1")]
        self.assertEqual(captured["tools"], [schema])
        self.assertEqual(captured["max_tokens"], 4096)
        self.assertEqual(captured["system_prompt"], request["messages"][0]["content"])
        self.assertEqual(request, before)

    def test_tokenizer_failure_is_labeled_or_refused_when_measurement_required(self):
        self.engine.settings["tokenizer_url"] = "https://model.example.com"
        payload = {"messages": [{"role": "user", "content": "synthetic"}], "tools": []}
        failure = engine_module.urllib.error.HTTPError("https://model.example.com", 400, "Synthetic rejection", {}, None)
        with patch.object(engine_module, "measured_tokens", side_effect=failure):
            self.assertIsNone(self.engine._callback("count", payload))
            self.assertTrue(self.engine._token_limitations)
            self.engine.settings["require_measured_tokens"] = True
            with self.assertRaisesRegex(protocol.EmberfoldError, "TOKENIZER_UNAVAILABLE"):
                self.engine._callback("count", payload)

    def test_bound_rebuild_intent_only_consumed_after_commit(self):
        output = self.engine.compress(self.initial())
        self.database.commit(output)
        checkpoint = engine_module.checkpoint_in(output)
        path = engine_module.data_path(self.home) / (engine_module.digest(self.engine.namespace) + ".rebuild.json")
        engine_module.private_json(path, {"expected_head": checkpoint["id"], "settings_sha256": engine_module.digest(self.engine.settings)})
        rebuilt = self.engine.compress(self.database.active)
        self.assertTrue(path.exists())
        self.database.commit(rebuilt)
        self.engine.on_session_start("session-1", boundary_reason="compression")
        self.assertFalse(path.exists())


class OnboardingTests(unittest.TestCase):
    def test_onboarding_never_prints_credentials_from_provider_urls(self):
        route = onboarding.display_route({"base_url": "https://alice:synthetic-password@model.example.com/v1?token=synthetic-token", "model": "synthetic"})
        self.assertEqual(route["base_url"], "https://model.example.com")
        self.assertNotIn("synthetic-password", json.dumps(route))
        self.assertNotIn("synthetic-token", json.dumps(route))

    def fixture(self, directory):
        stack = ExitStack()
        self.addCleanup(stack.close)
        home = Path(directory)
        config = {"memory": {"provider": "synthetic-memory"}, "model": {"provider": "custom", "model": "synthetic-model", "api_key": "synthetic-secret"},
                  "compression": {"threshold": 0.8, "protect_last_n": 20}}
        config_module = types.ModuleType("hermes_cli.config")
        config_module.is_managed = lambda: False
        config_module.read_user_config_raw = lambda: copy.deepcopy(config)

        def save(value, **kwargs):
            config.clear()
            config.update(copy.deepcopy(value))

        config_module.save_config = save
        scope_module = types.ModuleType("hermes_cli.managed_scope")
        scope_module.is_key_managed = lambda key: False
        parent = types.ModuleType("hermes_cli")
        parent.config = config_module
        parent.managed_scope = scope_module
        stack.enter_context(patch.dict(sys.modules, {"hermes_cli": parent, "hermes_cli.config": config_module,
                                                    "hermes_cli.managed_scope": scope_module}))
        root = home / "plugin-data/emberfold-hermes"

        def storage(*args):
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            return root

        stack.enter_context(patch.object(onboarding, "home_path", return_value=home))
        stack.enter_context(patch.object(onboarding, "read_config", side_effect=lambda: copy.deepcopy(config)))
        stack.enter_context(patch.object(onboarding, "data_path", side_effect=storage))
        stack.enter_context(patch.object(onboarding, "_emit"))
        stack.enter_context(patch.object(onboarding, "synthetic_check", return_value={"passed": True}))
        ctx = types.SimpleNamespace(llm=Summarizer())
        for name in ("register_auxiliary_task", "register_context_engine", "register_hook", "register_cli_command", "register_middleware"):
            setattr(ctx, name, lambda *args, **kwargs: None)
        return config, config_module, scope_module, root, ctx

    def test_setup_repeat_and_scoped_rollback_preserve_unrelated_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            config, config_module, scope_module, root, ctx = self.fixture(directory)
            args = types.SimpleNamespace(check=False, install_deps=False, json=True, profile="general", restart=False, yes=True)
            self.assertTrue(onboarding.setup(args, ctx)["configured"])
            record = (root / "setup-rollback.json").read_bytes()
            self.assertTrue(onboarding.setup(args, ctx)["configured"])
            self.assertEqual((root / "setup-rollback.json").read_bytes(), record)
            self.assertEqual(config["compression"]["protect_last_n"], 20)
            self.assertEqual(config["plugins"]["entries"]["emberfold-hermes"]["settings"]["trigger_ratio"], 0.8)
            config["memory"]["additional_operator_setting"] = "preserve"
            self.assertTrue(onboarding.rollback(args)["rolled_back"])
            self.assertEqual(config["memory"], {"provider": "synthetic-memory", "additional_operator_setting": "preserve"})
            self.assertEqual(config["model"]["api_key"], "synthetic-secret")
            self.assertIsNone(config["context"].get("engine"))

    def test_setup_check_is_read_only_and_managed_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            config, config_module, scope_module, root, ctx = self.fixture(directory)
            args = types.SimpleNamespace(check=True, install_deps=False, json=True, profile="general", restart=False, yes=True)
            before = copy.deepcopy(config)
            onboarding.setup(args, ctx)
            self.assertEqual(config, before)
            self.assertFalse(root.exists())
            scope_module.is_key_managed = lambda key: True
            with self.assertRaisesRegex(protocol.EmberfoldError, "CONFIGURATION_MANAGED"):
                onboarding._save_patch({("context", "engine"): "emberfold"})
            self.assertEqual(config, before)

    def test_rollback_refuses_to_overwrite_new_operator_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            config, config_module, scope_module, root, ctx = self.fixture(directory)
            args = types.SimpleNamespace(check=False, install_deps=False, json=True, profile="general", restart=False, yes=True)
            onboarding.setup(args, ctx)
            config["context"]["engine"] = "another-engine"
            with self.assertRaisesRegex(protocol.EmberfoldError, "ROLLBACK_CONFIG_CHANGED"):
                onboarding.rollback(args)
            self.assertEqual(config["context"]["engine"], "another-engine")

    def test_parser_covers_user_commands(self):
        parser = argparse.ArgumentParser()
        onboarding.configure_parser(parser)
        for command in ("setup --check", "status --json", "doctor", "rollback --yes", "rebuild --session synthetic --apply --expected-head synthetic"):
            self.assertIsNotNone(parser.parse_args(command.split()))

    def test_registration_uses_standard_context_and_host_owned_task(self):
        ctx = types.SimpleNamespace(llm=Summarizer())
        calls = []
        for name in ("register_auxiliary_task", "register_context_engine", "register_hook", "register_cli_command", "register_middleware"):
            setattr(ctx, name, lambda *args, _name=name, **kwargs: calls.append((_name, args, kwargs)))
        with patch.object(engine_module, "read_config", return_value={}), patch.object(engine_module, "home_path", return_value=Path(tempfile.gettempdir())):
            plugin.register(ctx)
        self.assertEqual(calls[0][2]["inherit_from"], "compression")
        self.assertEqual(calls[1][1][0].name, "emberfold")

    def test_skipped_dependencies_have_actionable_error(self):
        with patch.object(protocol, "ROOT", Path("/nonexistent-synthetic-plugin")):
            with self.assertRaisesRegex(protocol.EmberfoldError, "DEPENDENCIES_MISSING"):
                protocol.node_path()

    def test_externally_owned_context_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = plugin.EmberfoldEngine(config={}, home=directory)
            with self.assertRaisesRegex(protocol.EmberfoldError, "RUNTIME_UNSUPPORTED"):
                engine.update_model("synthetic", 32000, api_mode="codex_app_server")


if __name__ == "__main__":
    unittest.main()
