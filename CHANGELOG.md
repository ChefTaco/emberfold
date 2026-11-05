# Changelog

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
