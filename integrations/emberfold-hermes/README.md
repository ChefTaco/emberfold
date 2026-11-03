# Emberfold for Hermes

A standard Hermes context-engine plugin. Emberfold runs locally, reuses your
Hermes compression model and credentials, and keeps source-cited checkpoints,
corrections, unresolved work, and exact protected passages. It does not replace
your memory provider, change tool permissions, or require an Emberfold account.

## Quickstart

Use a configured Hermes installation with the context-engine and plugin LLM
interfaces. The first verified runtime is Hermes `cabaf053b5b42885a9b11827925473748e54b090`.
Install Node `^24.22.1` or `^26.13.0`. No root privileges or Docker are required.

```bash
hermes plugins install ChefTaco/emberfold/integrations/emberfold-hermes --ref FULL_RELEASE_COMMIT --enable
hermes emberfold setup
hermes emberfold status --json
```

Replace `FULL_RELEASE_COMMIT` with a reviewed **40-character commit**, not a tag
or branch. See the repository's `hermes-v*` releases. Accept Hermes's separate
Node dependency question during installation. If dependencies were skipped, run
`hermes emberfold setup --install-deps` to explicitly install the pinned lockfile.
This executes `npm ci --ignore-scripts` inside this plugin only.

Setup displays the selected home, summarizer route, protection settings, and
proposed changes. After confirmation it performs a synthetic model check, saves
private rollback settings, and selects `context.engine: emberfold`. It never
installs dependencies during a model turn or starts a second messaging gateway.
Restart your existing gateway when requested, or explicitly consent with
`setup --restart`. A normal session must actually select the engine before
`status` reports active. Installation and synthetic checks alone are not activation.

For unattended onboarding, inspect `setup --check --json` first, then use
`setup --yes --install-deps`. `--yes` also approves the synthetic model call.
`--check` makes no model calls and does not write plugin state or configuration.
Use the intended `HERMES_HOME` for every command. Named profiles are separate;
the default home is not necessarily `profiles/default`.

## Operation

Automatic compression and native `/compress [focus]` use Emberfold. New installs
keep two recent complete exchanges. Setup also inherits stronger existing head,
tail, and trigger settings; whole exchanges round protection outward. Summaries
are historical, unverified data, never authority or proof of external completion.

The `emberfold_compression` auxiliary task inherits Hermes's `compression` model.
Change it through Hermes's auxiliary-model configuration; no credential copying
is necessary. Summarization is a bounded host-owned call without tools. There is
no implicit Emberfold cloud fallback. Setup disables the plugin task's configured
fallback chain; an operator can explicitly configure a different route later.

```bash
hermes emberfold doctor --json
hermes emberfold inspect --session SESSION_ID
hermes emberfold recall --session SESSION_ID --message-id SOURCE_ID
hermes emberfold protect --session SESSION_ID --message-id SOURCE_ID --start 0 --end 12
hermes emberfold rebuild --session SESSION_ID
hermes emberfold rebuild --session SESSION_ID --apply --expected-head CHECKPOINT_ID
```

Protection offsets are **UTF-16 code units**, not Python character indexes.
Protection uses the original content digest and remains outside generated
summaries. Rebuild is read-only by default. `--apply` queues a head-bound rebuild;
run `/compress` in that session to execute it through Hermes's normal commit path.
It does not directly edit the transcript or claim publication before that commit.
The read-only `emberfold_recall` model tool recovers at most 16 cited messages
and 64 KiB from the current conversation, never arbitrary files or URLs.

## Configuration and limits

Settings live under `plugins.entries.emberfold-hermes.settings`; setup records
effective values so changes to built-in compressor settings do not silently
change an existing Emberfold policy. Available settings include `profile`
(`general`, `creative`, `reflective`), `trigger_ratio`, `recent_exchanges`,
`protect_first_n`, `protect_last_n`, summarizer input/output/summary token budgets,
`output_reserve_tokens`, `safety_tokens`, `timeout_seconds`, `max_passes`,
`require_measured_tokens`, and `tokenizer_url`.

`tokenizer_url` is an administrator-selected llama.cpp server root supporting
`/apply-template` and `/tokenize`, for example `https://model.example.com`.
Redirects and embedded URL credentials are refused. Setup probes a configured
compatible endpoint with synthetic text. Complete rendered prompts include tool
schemas, checkpoint envelopes, retained content, and output/safety reserves.
Other routes use explicitly labeled estimates; `require_measured_tokens: true`
refuses estimates. Media requests are not reported as provider-measured unless
the tokenizer actually handles their modality.

Opaque/multimodal messages and legacy summaries remain protected, not flattened
or represented as recoverable originals. Sources require Hermes's durable
`message_uid`. Compression is bounded to 10,000 source rows, 16 MiB protocol
messages, 600 seconds maximum, and the configured summarization work limit.
Externally owned `codex_app_server` context is not supported. Run a normal turn
before manual compression so the engine can observe tool schemas and reserves.

Hermes retains authoritative originals and controls compression locks, source
watermarks, cancellation, and commits. Checkpoint envelopes travel in native
historical handoff messages. Plugin indexes are derived and rebuilt from committed
handoffs after restart. Source digests use original physical rows, not Hermes's
potentially whitespace-trimmed provider/display projections. Missing sources,
corrupt checkpoints, policy changes, failed providers, and insufficient budgets
fail visibly without publishing an Emberfold head. Rebuild explicitly after policy
changes. Exact recovery covers retained originals only, not history deleted before
onboarding or subsequently removed through Hermes's own retention controls.

Private state uses Hermes's profile-scoped `plugin-data/emberfold-hermes`, outside
the installation tree. It survives plugin updates/removal. No provider credentials,
transcripts, or operational inventories belong in the public repository.

## Upgrade, rollback, and removal

Review the new release, back up private settings, then reinstall the same source
with `--force --ref NEW_FULL_COMMIT`. Pinned installs do not track branch tips.
Restart the same gateway and verify a real session, recall, and `status` again.
Do not overwrite existing release tags or package versions.

```bash
hermes emberfold rollback --yes
```

Rollback restores only setup-owned settings, refusing to overwrite subsequent
operator changes. It never restores an old database over newer messages. Existing
historical handoffs remain ordinary readable messages for the built-in compressor.
Restart the existing gateway, verify the previous engine, then optionally run
`hermes plugins disable emberfold-hermes` and `hermes plugins remove emberfold-hermes`.
Removing an active plugin without switching engines first is not a safe rollback.

## Development

From the Emberfold repository, install root dependencies and this plugin's exact
lockfile, then run `npm run hermes:test` and `npm run verify`. The checked-in
`bridge/worker.js` is generated from strict TypeScript by `npm run hermes:build`;
it is shipped so users do not need a compiler or a build step at installation.
Validate the installed plugin using `hermes plugins doctor emberfold-hermes --ci`
and `hermes plugins validate PATH --json` before a model-backed acceptance session.
See [deployment](DEPLOYMENT.md) for the scoped adoption checklist.
