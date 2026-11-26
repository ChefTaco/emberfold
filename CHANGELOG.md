# Changelog

## Unreleased

## Hermes Plugin 0.2.0 - 2026-11-26

- The plugin now pins `@hivemagnus/emberfold@0.4.0` instead of 0.1.0, so its context preparation gets the 0.4.0 fixes (later tool results of 512 characters or more are no longer over-truncated, provider failures carry stable codes). The plugin reads the expected engine version from its own `package.json` rather than a hard-coded copy.
- The plugin requires Node `^24.22.3` or `^26.13.1` (previously `^24.22.1` or `^26.13.0`), matching the core packages' patched-runtime floor.

### Upgrade notes

- After installing 0.2.0 (`hermes plugins install ... --ref COMMIT --force --enable`), reinstall the plugin's pinned lockfile with `hermes emberfold setup --install-deps`; otherwise the plugin refuses to start with `DEPENDENCY_VERSION_MISMATCH`.
- Hosts on an older Node patch get `NODE_UNSUPPORTED: require ^24.22.3 or ^26.13.1`; upgrade Node first.
- No Hermes state or database migration: Hermes still owns transcripts and compression commits, and the plugin's private indexes are recoverable derived state. To roll back, reinstall 0.1.1 at its release commit with `--force` and restore its Node dependencies; never restore an old database.
- This release pins core 0.4.0, not 0.5.0; no core package or image is republished.

## [0.5.0] - 2026-11-26

### Upgrade notes

- No database, schema or state migrations: the library, CLI and service are stateless, so a Hive suite upgrade needs no `--allow-migrations` for Emberfold.
- An `http` provider with `api_key_env` must use an `https:` URL unless the host is loopback, or the service and CLI fail at startup with `Invalid provider URL: a provider credential requires HTTPS unless the host is loopback`. Move the provider behind TLS or reach it through a loopback tunnel or proxy.
- The Codex child process receives only the allowlisted environment. Move any other variable your Codex setup needs into Codex's own configuration or a `CODEX_*` name.
- Service request logs are HiveCommon JSON records (`time`, `level`, `msg`, `service`, `request_id`, `trace_id`, `error`) and record the matched route instead of the raw URL. Update log parsers that read the old fields only. `/healthz` and `/readyz` are unchanged; `/health/live`, `/health/ready` and authenticated `GET /metrics` are new.
- Oathweave service tokens are opt-in through the new `oathweave` configuration block; without it authentication is unchanged.
- Downgrade to 0.4.0 is safe after removing any `oathweave` block (0.4.0 rejects unknown configuration keys); 0.4.0 again accepts credentialed plain-HTTP providers and passes Codex the full environment. Callers of `POST /v1/recall` or `/metrics` lose those endpoints.
- The Hermes plugin is released separately; this release does not change any installed `hermes-v*` plugin.

### Security

- An `http` provider that sends a credential (`api_key_env`) now requires an `https:` URL unless the host is loopback (`localhost`, `127.0.0.0/8`, `[::1]`). Previously the Bearer token was sent over plain HTTP to any host. **Upgrade note:** a configuration such as `"base_url": "http://model.example.com:8000/v1"` with `api_key_env` now fails at startup with `Invalid provider URL: a provider credential requires HTTPS unless the host is loopback`; move the provider behind TLS, or reach it through a loopback tunnel or proxy. Providers without a credential are unchanged.
- The Codex child process no longer inherits the whole environment. It receives an allowlist (`HOME`, `PATH`, user, locale, time zone, temporary and XDG directories, CA and proxy settings, `CODEX_*`, and `OPENAI_API_KEY`/`OPENAI_BASE_URL` only with `auth_mode: "apiKey"`), so the service token and other providers' credentials no longer reach the model-driven process. The new `codexEnvironment()` export shows the filtering. **Upgrade note:** if your Codex setup depends on another variable, set it in Codex's own configuration or with a `CODEX_*` name.

### Added

- The HTTP service can accept Oathweave client-credentials tokens alongside the static bearer (new optional `oathweave` configuration: issuer, optional native issuers, JWKS URL, audience `emberfold` and scope `emberfold:context` by default). Tokens must be service tokens for that exact audience and carry the scope in `scope` or `permissions`; request logs record which caller was authenticated. Without `oathweave`, authentication is unchanged.
- `POST /v1/recall` on the HTTP service returns original messages by ID, like the CLI's `recall`.
- Authenticated Prometheus `GET /metrics`: requests by operation and status, request duration, compactions, provider failures by code, requests in flight and readiness.
- The service uses `@hivemagnus/hive-common` 0.7.0: suite health paths `/health/live` and `/health/ready`, `X-Request-Id` on every response (the caller's when valid), and structured JSON request logs with request and trace IDs, the error code and `x-hive-execution` attribution.

### Fixed

- `fitContext` no longer splits a surrogate pair when it shortens a tool result.
- With a provider tokenizer, identical input is measured once per operation, and candidate prompts that the local estimate (scaled by the last measured ratio) puts more than 25% over budget are rejected without a provider call. A fit is still always decided by a measurement. This removes most tokenizer round trips while halving summarizer chunks and shortening tool results.
- `npm test` builds the workspace first, so a stale `dist/` no longer makes local test runs fail.
- The Ardent compatibility gate in CI now checks Ardent 3.3.0, the shipping consumer, instead of the 2.1.1 extraction commit, and keeps every `@types/*` package Ardent declares so its full typecheck runs.
- The service matches routes by path, so `/healthz?probe=1` answers instead of returning 401, and a query string on an API path no longer gives 404. Request logs record the matched route instead of the raw URL, so query strings are never logged.

### Changed

- Documentation checked against the source: AGENTS, README and operations guidance, and the current Ardent release's exact `@hivemagnus/emberfold` pin.
- Request log lines now come from HiveCommon's logger (`time`, `level`, `msg`, `service` fields added, secrets redacted) and carry `request_id`, `trace_id` and, on failure, `error`. A custom `log` sink passed to `createEmberfoldServer` receives the same record fields as before plus these. The `/healthz` and `/readyz` bodies are unchanged.
- Summarizer excerpts now carry the message `role`, and on a message's first excerpt its `tool_call_id` and a bounded rendering of its `tool_calls` (at most 16 calls, each with its ID, function name and arguments cut to 512 characters; `tool_calls_omitted` counts the rest). Previously the summarizer saw only message text, so it could not tell user, assistant and tool text apart, and the calls an assistant made were dropped. When a message's calls cannot fit the summarizer input budget, only the call IDs and names are kept. The evaluation adds a tool-call scenario whose answer exists only in a tool call. Custom summarizers that parse the prompt see the new optional fields; existing fields are unchanged.

## [0.4.0] - 2026-11-13

### Fixed

- HTTP provider and tokenizer failures now carry stable codes. An unreachable provider, a provider timeout, or a non-JSON or malformed provider response is reported as `PROVIDER_FAILED` (`TOKENIZER_UNAVAILABLE` for token counting) instead of an uncoded error. The service previously answered these with `400` or `422` `INVALID_REQUEST`, and the CLI exited 2 as if the input were invalid; the service now answers `422` with the provider code and the CLI exits 4. Caller cancellation is passed through unchanged.
- Model output that is still unparseable or schema-invalid after the repair attempt fails with `INVALID_SUMMARY` instead of surfacing as a malformed request (`400`) from the service.
- Malformed Codex app-server replies fail with `CODEX_PROTOCOL_INVALID` instead of an uncoded validation error.
- The CLI reports an expired `timeout_ms` deadline as `DEADLINE_EXCEEDED` with exit code 4 instead of `INVALID_INPUT` with exit code 2.
- The service answers an oversized request body with `413` without abandoning the connection mid-upload. It discards the rest of the body for at most five seconds (or `timeout_ms`, if shorter), so a client that is still sending reads the response, and the connection stays usable.
- `fitContext` stops shortening tool results once the prompt fits. Previously, after the first shortened result brought the prompt within budget, every remaining unprotected tool result of 512 characters or more was still cut to at most half its length.

### Changed

- `tokenEstimate` has one implementation, exported unchanged from `@hivemagnus/emberfold` and `@hivemagnus/emberfold/compat`.

## [0.3.0] - 2026-11-12

- Add an opt-in `emberpath` provider type for the service and CLI. It shares the `http` implementation, takes the gateway root from `base_url` or `EMBERPATH_URL` (appending `/v1`), and sends the client key from `EMBERPATH_API_KEY` as a Bearer token. Existing provider configurations are unchanged.

## [0.2.3] - 2026-11-11

- Require patched Node.js 24.22.3 or 26.13.1, and refresh build and runtime image pins for upstream TLS and HTTP/2 security fixes.

## [0.2.2] - 2026-11-10

### Security

- Run containers on the pinned, patched Node 26 runtime with maintained system libraries.

## 0.2.1 - 2026-11-05

### Security

- Pin both image stages to `node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c` (same Node, refreshed Debian).
- Remove npm, npx, Corepack, Yarn, apt, and libapt-pkg6.0 from the runtime image after production dependencies are installed. The service runs only Node. This removes the fixable findings in npm's bundled brace-expansion 5.0.9 and undici 6.28.0 and in apt/libapt-pkg6.0 2.6.1 (CVE-2026-109518). The dpkg database is kept so scanners still inventory OS packages.
- Trivy 0.70.0 reports no fixable HIGH or CRITICAL findings in the runtime image. Debian publishes no fix yet for: CVE-2023-45853 (zlib1g, CRITICAL, will not fix), CVE-2026-76844 (zlib1g), CVE-2025-69720 (ncurses), CVE-2026-16742 (libsystemd0, libudev1), CVE-2026-41992 (gzip), CVE-2026-53613, CVE-2026-53615, and CVE-2026-78410 (util-linux), CVE-2026-54369 (libacl1), and CVE-2026-9538 (perl-base).

## 0.2.0 - 2026-11-05

- Publish the service image for linux/amd64 and linux/arm64 as one multi-architecture index with a build provenance attestation, refusing to overwrite an existing version tag.
- Install Hermes sidecar dependencies in the release workflow so release verification matches CI.
- Reconcile recorded Ardent and Hermes adoption milestones, pin Hermes onboarding to plugin 0.1.1, and document independent releases, dependency repair, shared-gateway safety, and recovery boundaries.
- Review Magnus 1.1.8 and add isolated packed-engine compatibility checks against Ardent's context tests and runtime types on both supported Node lines.
- Refresh rollout guidance to distinguish historical authority failures from current managed-ownership restrictions.
- Pin transitive development dependency minimatch to 11.0.1 to fix GHSA-g3hv-75wg-m249 (glob preprocessing denial of service) until upstream tooling adopts the patched major version.
- Add regression coverage for bounded glob preprocessing through each affected tooling dependency.

## Hermes Plugin 0.1.1 - 2026-11-03

- Capture complete provider tool schemas through read-only request middleware instead of budget-counting sanitized observer projections.
- Label tokenizer-unavailable estimates explicitly; keep measured-only policies fail-closed.
- Recover stripped native-gateway checkpoint markers from matching committed message identities, preserving checkpoint ancestry on manual compression and rebuild.
- Preserve unpersisted current exchanges during automatic preflight without publishing temporary identities as historical sources.
- Include the complete summary schema in counted summarizer input, including bounded citations per item.

## Hermes Plugin 0.1.0 - 2026-11-03

- Add the standard Hermes context-engine plugin with local pinned sidecar, guided onboarding, host-owned summarization, source recovery, and scoped rollback.
- Preserve Hermes's authoritative transcript and commit fences, including original-row recovery independent of display projections.

## 0.1.0

- Extract deterministic prompt fitting and checkpoint preparation from Ardent.
- Add storage-independent context preparation, exact protected spans, source recovery, and checkpoint rebuilding.
- Add general, creative, and reflective profiles with attributed, unverified summary items and explicit relationships.
- Add optional Codex and compatible HTTP adapters, JSON CLI, authenticated stateless service, and deployment tooling.
