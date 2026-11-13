# Changelog

## Unreleased

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
