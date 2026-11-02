# Changelog

## Unreleased

- Pin transitive development dependency minimatch to 11.0.1 to fix GHSA-g3hv-75wg-m249 (glob preprocessing denial of service) until upstream tooling adopts the patched major version.
- Add regression coverage for bounded glob preprocessing through each affected tooling dependency.

## 0.1.0

- Extract deterministic prompt fitting and checkpoint preparation from Ardent.
- Add storage-independent context preparation, exact protected spans, source recovery, and checkpoint rebuilding.
- Add general, creative, and reflective profiles with attributed, unverified summary items and explicit relationships.
- Add optional Codex and compatible HTTP adapters, JSON CLI, authenticated stateless service, and deployment tooling.
