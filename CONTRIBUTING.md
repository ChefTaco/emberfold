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
