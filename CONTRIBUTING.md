# Contributing

Use Node matching `package.json`, then `npm ci` and `npm run verify`.
Behavior changes need regression tests. Add contract changes to the changelog;
generate contracts with `npm run contracts:write` and commit the resulting files.
Use Conventional Commits. Keep fixtures synthetic and deployments configurable.
See AGENTS.md for preservation and privacy requirements.
