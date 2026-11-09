# Contributing

Use Node matching `package.json` and Python 3, then install both lockfiles:

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix integrations/emberfold-hermes
npm run verify
```

Verification includes core tests, Hermes plugin regressions, generated-worker
compilation, contracts, privacy checks, and packaged installations outside the
checkout. `npm run hermes:test` runs the focused plugin suite. The checked-in
`integrations/emberfold-hermes/bridge/worker.js` is generated from TypeScript;
regenerate it with `npm run hermes:build`, never edit it manually.

Behavior changes need regression tests. Add contract changes to the changelog;
generate contracts with `npm run contracts:write` and commit the resulting files.
Use Conventional Commits. Keep fixtures synthetic and deployments configurable.
See AGENTS.md for preservation and privacy requirements.

Plugin tests use synthetic host contracts and fixed summarizers. They are not a
substitute for installed Hermes validation, real native-session acceptance, or
semantic continuation evaluation. Keep runtime inventories, credentials, real
transcripts, and operational receipts out of public documentation and fixtures.
Document sanitized, dated acceptance milestones rather than claiming continuous
fleet health. Plugin and core release versions are independent; see
[operations](docs/OPERATIONS.md#independent-release-streams).

## Secret scanning

Install the pinned, checksum-verified Gitleaks CLI before contributing:

```bash
bash scripts/install-gitleaks.sh
git config core.hooksPath .githooks
bash scripts/test-gitleaks.sh
bash scripts/gitleaks.sh --staged
bash scripts/gitleaks.sh --history
```

Gitleaks 8.30.1 is free and runs directly; no paid Action or organization license
is required. The installer supports Linux and macOS on x64 and ARM64 and uses the
user cache, without sudo. Other platforms can put that exact version on PATH.
Missing or incompatible binaries fail the hooks rather than skipping checks.

The commit hook scans an export of the exact Git index, including force-added
ignored files. The push hook scans every outgoing ref's commit range, including
secrets deleted in a later commit. New refs or unavailable remote bases receive
a complete reachable-history scan. Existing privacy checks still run.

The `Gitleaks` workflow scans full reachable history on pushes, pull requests
and merge queues, and runs synthetic regression checks. Maintain `Gitleaks` as a
required status check on the default branch. CI runs after upload and can block
merging; local hooks and GitHub's native push protection help prevent upload.
Local hooks can be bypassed or absent on other clones, so install them in each
clone. No scanner guarantees detection of arbitrary secrets.

All output redacts matched secrets. Inline `gitleaks:allow` comments are ignored.
Review findings privately: rotate a real exposed credential and remove it through
the appropriate incident process. Never add real credentials to an allowlist.
Any false-positive exception in `.gitleaks.toml` must match both one exact value
and a specific file, with a reason; do not exempt whole test or documentation
directories or disable built-in detection rules.
