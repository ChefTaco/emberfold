# Ardent and Magnus compatibility

## Reviewed consumer

Ardent, the engine's consumer, now lives in its own repository,
[ChefTaco/Ardent](https://github.com/ChefTaco/Ardent); it was previously
`packages/ardent` in the Magnus monorepo. Ardent 2.1.1 (`90ec90594a15ad412e1385dc6cb9972f15eec66a`, the
repository's extraction commit) still declares `@hivemagnus/emberfold` exactly
`0.1.0`. Before the move, Magnus 1.1.12 (`1f2473112771abdbc1d5288188abfe681c045142`)
was the reviewed consumer with the same declaration. Its context fitting, checkpoint storage
adapter, policy pinning, and additive SQLite metadata retain the original engine
contract. Managed context-only adoption now preserves extended legacy runtimes
without requiring a wholesale public Ardent installation. Enrollment, A2A
admission, rate limits, and lifecycle coordination remain host responsibilities;
they require no engine API change.

The library is a direct dependency. Neither Ardent startup nor context preparation
depends on the optional Emberfold HTTP service. Keep policy loading, caller and
profile isolation, task eligibility, effect journals, and checkpoint publication
transactions in Ardent. Do not move Magnus command leases or enrollment into the
storage-independent engine.

## Compatibility gate

`npm run compat:ardent -- --source PATH --revision COMMIT` builds and packs the
current engine, extracts the tracked source of an Ardent checkout at the selected
trusted commit, and installs the tarball into a disposable project outside either
checkout. It
typechecks Ardent and runs its original context/checkpoint tests against that
tarball, not the already-published dependency. Installation scripts are disabled;
child processes receive no deployment or provider credentials. Tests must all
pass, with no skipped cases. A private receipt goes under `output/compatibility/`.
The command executes source/tests from the selected repository: use only a trusted
checkout and revision. It does not fetch or update the checkout for you.

CI runs the gate on both supported Node lines against the reviewed Ardent commit
above. When Ardent changes, review its adapter, policy, store, model-request
rendering, and context tests before updating that pin; prefer a release tag once
one exists. For a new engine release, verify the
candidate before changing Ardent's exact dependency. Do not republish `0.1.0` or
move an existing tag to incorporate tooling changes.

## Deployment and ownership

A successful library compatibility check does not prove a fleet rollout. Inventory
actual node-manager state and deployed package versions; they can differ from a
local checkout and from the latest public release. Preserve legacy runtime
capabilities when a wholesale Ardent replacement would widen scope.

The original `ENROLLMENT_AUTHORITY_UNAVAILABLE` receipt is historical evidence,
not a current diagnosis. A fresh admission decision can instead show that the
authority is reachable but legacy dispatch is forbidden because the node is
draining, enrolled, or has sticky ownership history. Do not clear enrollment,
disable guards, use direct SSH as a workaround, or retry an uncertain command.
Use the current Magnus-managed admission path and inspect exact signed receipts.
An Ardent lifecycle action does not authorize arbitrary module replacement.

Magnus 1.1.8 adds read-only agent upgrade preflight and better signed refusal and
recovery evidence. Those features concern Magnus node-manager upgrades, not
proof that an Ardent profile has adopted Emberfold. A draining node still needs
its real participant evidence; a missing receipt or lease expiry is never enough
to claim that an external effect did not happen.

Magnus 1.1.12 provides `context-stage`, `context-adopt`, and `context-rollback`
through its managed Ardent API. Full-node enrollment retains node-wide ownership
while using the native Ardent coordination fence; an Ardent-only scope is not
implicitly granted. Legacy SQLite read permissions are accepted only inside an
owner-private state directory, without changing existing permissions.

Follow [Magnus's context-only adoption protocol](https://github.com/ChefTaco/magnus/blob/v1.1.12/docs/ARDENT_CONTEXT_ADOPTION.md).
Staging uses an isolated synthetic database with the profile's configured model
provider, tools disabled, and exact release, base-runtime, policy, and config pins.
Adoption preserves originals and unknown effects, restarts the real gateway,
physically switches to the retained previous runtime for rollback verification,
then restores the adopted runtime. Require signed completion evidence for each
stage; a diagnostic journal phase alone is not completion authority. Neither a
manager upgrade nor one profile's acceptance proves fleet-wide adoption.

Retain the isolated pilot and per-profile source, journal, restart, continuation,
recovery, and rollback acceptance requirements. Keep operational state and receipts
private, and leave unfinished production acceptance unchecked.

## Recorded adoption outcome

The reviewed managed context-only rollout completed individual production-profile
acceptance on 2026-11-03 with core `0.1.0`. Compaction, continuation, exact source
recovery, rebuild, original-message preservation, and physical previous-reader
rollback passed through the managed path. Historical uncertain effects were not
replayed or reclassified as successful. Identities, inventories, signed receipts,
and deployment-specific package digests remain private.

This dated outcome supersedes the initial blocked-rollout status; it does not
relax admission controls or establish current fleet health. Revalidate every
target before future changes. Hermes plugin adoption is a separate integration,
with its own version, profile scope, and native gateway acceptance; see the
[Hermes deployment guide](../integrations/emberfold-hermes/DEPLOYMENT.md).
