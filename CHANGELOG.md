# Changelog

## Unreleased

- Review Magnus 1.1.8 and add isolated packed-engine compatibility checks against Ardent's context tests and runtime types on both supported Node lines.
- Refresh rollout guidance to distinguish historical authority failures from current managed-ownership restrictions.
- Pin transitive development dependency minimatch to 11.0.1 to fix GHSA-g3hv-75wg-m249 (glob preprocessing denial of service) until upstream tooling adopts the patched major version.
- Add regression coverage for bounded glob preprocessing through each affected tooling dependency.

## Hermes Plugin 0.1.1 - 2026-11-03

- Capture complete provider tool schemas through read-only request middleware instead of budget-counting sanitized observer projections.
- Label tokenizer-unavailable estimates explicitly; keep measured-only policies fail-closed.

## Hermes Plugin 0.1.0 - 2026-11-03

- Add the standard Hermes context-engine plugin with local pinned sidecar, guided onboarding, host-owned summarization, source recovery, and scoped rollback.
- Preserve Hermes's authoritative transcript and commit fences, including original-row recovery independent of display projections.

## 0.1.0

- Extract deterministic prompt fitting and checkpoint preparation from Ardent.
- Add storage-independent context preparation, exact protected spans, source recovery, and checkpoint rebuilding.
- Add general, creative, and reflective profiles with attributed, unverified summary items and explicit relationships.
- Add optional Codex and compatible HTTP adapters, JSON CLI, authenticated stateless service, and deployment tooling.
