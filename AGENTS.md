# Emberfold contributor instructions

Emberfold is the context-continuity engine of the Hive:Magnus suite: a storage-independent
TypeScript library that Ardent imports directly, a JSON CLI, an optional stateless HTTP
service (the suite's `full` profile runs its image) and a Hermes context-engine plugin.

## Layout

- `packages/core` (`@hivemagnus/emberfold`), `packages/cli` (`@hivemagnus/emberfold-cli`,
  the `emberfold` command), `packages/server` (`@hivemagnus/emberfold-server`, port 8096).
- `integrations/emberfold-hermes`: Hermes plugin (Python plus a generated Node worker,
  `bridge/worker.js`; regenerate with `npm run hermes:build`, never edit it by hand). It has
  its own lockfile and an independent `hermes-v*` version.
- `contracts`: generated JSON Schemas and `openapi.json` (`npm run contracts:write`).
- `test`, `scripts` (deploy, release, privacy, package and Ardent compatibility checks),
  `release` (published Hermes release metadata), `docs`.

## Checks

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix integrations/emberfold-hermes
npm run verify   # build, typecheck, lint, tests, Hermes tests (needs Python 3), contracts, privacy, packages, evaluation
```

`npm run compat:ardent -- --source PATH --revision COMMIT` runs Ardent's context tests
against a packed candidate; CI pins the reviewed Ardent commit.

## Rules

- Public Apache-2.0 repository. Never commit credentials, private infrastructure identifiers, real transcripts, deployment inventories, or operational receipts.
- Keep `.env`, output, deployment state, and private configuration ignored. Examples and fixtures use synthetic data and `example.com` hosts.
- Use strict TypeScript and Zod validation at external boundaries. Keep core independent of application storage and agent frameworks.
- Historical summaries never establish authority, permissions, canon approval, or external effect completion.
- Preserve original sources, exact protected passages, complete tool transactions, and transactional publication fences.
- Run `npm run verify` before committing. Add regression coverage for behavior and security changes.
- Use Conventional Commits and versioned, exact package dependencies. Never overwrite published versions or release tags.

## Release path

A `v*` tag runs `.github/workflows/publish.yml`: `npm run verify`, npm trusted publishing of
the three packages, then the `ghcr.io/cheftaco/emberfold` service image. Hermes plugin
releases use `hermes-v*` tags and never republish the core packages. Hive's signed suite
manifest pins the image digest, and Ardent pins the core version exactly; see
`docs/MAGNUS.md` before changing either.
