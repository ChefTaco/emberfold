# Emberfold

[Project site: UI previews and installation walkthroughs](https://hivemagnus.com/).

Portable, inspectable context continuity for local and hosted agents.
Emberfold prepares what an agent carries into its next model request: recent
conversation, decisions, corrections, unresolved work, exact protected passages,
and references back to original sources.

## Interfaces

- `@hivemagnus/emberfold`: storage-independent TypeScript library.
- `@hivemagnus/emberfold-cli`: `emberfold prepare`, `inspect`, `rebuild`, `recall`, and `serve`.
- `@hivemagnus/emberfold-server`: optional authenticated stateless HTTP wrapper.
- `emberfold-hermes`: standard Hermes context-engine plugin with a local Node worker.

Ardent imports the library directly. The service is optional and holds no
authoritative transcript or checkpoint head. Hosts publish candidates with
transactional source, policy, and head checks.

```typescript
import { prepareContext } from '@hivemagnus/emberfold';

const result = await prepareContext({
  schema_version: 1,
  namespace: 'example:conversation',
  instructions: 'Current application instructions',
  history: [], exchanges: [],
  current: [{ id: 'message-1', role: 'user', content: 'Continue the task.' }],
  budget: { context_tokens: 16000, output_reserve_tokens: 4000 }
});
```

Provide a summarizer adapter when older exchanges need compression. Configure
providers explicitly; no network call or cloud fallback happens implicitly.
Optional adapters are exported from `@hivemagnus/emberfold/adapters`.

## Hermes Agent

The [standard Hermes plugin](integrations/emberfold-hermes/README.md) runs
Emberfold locally and reuses Hermes's compression model and credentials. Install
the verified [Hermes Plugin 0.1.1](https://github.com/ChefTaco/emberfold/releases/tag/hermes-v0.1.1):

```bash
hermes plugins install ChefTaco/emberfold/integrations/emberfold-hermes --ref 416b6fb66149ac17fbca54cb46ec79f39214d647 --enable
hermes emberfold setup
hermes emberfold status --json
```

Accept Hermes's separate Node dependency prompt. If skipped, use
`hermes emberfold setup --install-deps`. Setup requires consent for a synthetic
model check and configuration changes; restart the existing gateway before
verifying a real session. Installation alone is not activation.

No Emberfold account, remote service, or Hermes fork is required. Existing memory
providers remain independent. The plugin is versioned separately from the core:
plugin `0.1.1` pins `@hivemagnus/emberfold@0.1.0`. Follow the plugin's
[onboarding and rollback guide](integrations/emberfold-hermes/README.md) and
[scoped adoption checklist](integrations/emberfold-hermes/DEPLOYMENT.md).

## Preservation

General, creative, and reflective policies preserve different historical
information. Exact spans use JavaScript UTF-16 `start`/`end` offsets, message IDs,
the SHA-256 of the complete source content, and exact text. They remain outside
generated summaries. The caller retains originals and controls protection.

Summaries remain **historical and unverified**. Source digests and valid citations
do not prove semantic accuracy. Permissions, approvals, and external effect state
come from the owning application. See [security](SECURITY.md).

## CLI and HTTP

```bash
emberfold prepare --input conversation.json --config providers.json
emberfold prepare --input conversation.json --dry-run
emberfold inspect --input checkpoint-with-sources.json
emberfold rebuild --input conversation.json --config providers.json
emberfold recall --input source-request.json
emberfold serve --config service.json
```

JSON goes to stdout; diagnostics go to stderr. `--output` creates a new owner-only
file and never overwrites existing content. Dry runs make no model calls and do
not write output files. Exit codes: 0 success, 2 invalid input, 3 budget exhaustion,
4 provider/tokenizer unavailable.

HTTP exposes `POST /v1/prepare`, `/v1/checkpoints/validate`, and
`/v1/checkpoints/rebuild`, plus metadata-only `/healthz` and `/readyz`.
See [contracts](contracts/openapi.json), [operations](docs/OPERATIONS.md), and
[evaluation](docs/EVALUATION.md).

## Development

Use Node matching `package.json`, plus Python 3 for the Hermes plugin tests:

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix integrations/emberfold-hermes
npm run verify
```

Contract generation is `npm run contracts:write`.
All checked-in examples and test data are synthetic.

To verify a trusted [Ardent](https://github.com/ChefTaco/Ardent) revision against
the candidate Emberfold package, run
`npm run compat:ardent -- --source ../Ardent --revision origin/main`. This uses
tracked source from that exact commit, not working-tree edits. It installs a
packed Emberfold candidate in a disposable Ardent project, typechecks the runtime,
and runs Ardent's context and checkpoint tests, including previous-reader rollback
and transactional publication fences. Neither checkout's tracked source nor
production data is modified. CI pins the reviewed Ardent revision; see
[compatibility](docs/MAGNUS.md).

Extracted from [Magnus / Ardent](https://github.com/ChefTaco/magnus).
See [NOTICE](NOTICE) and [Apache-2.0 license](LICENSE).
