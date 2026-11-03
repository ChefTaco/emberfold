# Scoped Hermes adoption

1. Resolve the real installation, user, active `HERMES_HOME`, Hermes revision,
   gateway service/scope, selected model/runtime, memory provider, and other
   profiles. Verify read-only inventory against the running host. Keep target
   identifiers and receipts outside public source.
2. Check the release's Hermes and Node prerequisites. Preserve private
   configuration and original transcript backups through the host's existing
   backup mechanism. Never copy provider credentials into a plugin. The
   `hermes emberfold` commands become available only after plugin installation.
3. Install the exact public release using the standard plugin command in an
   isolated home first. Use only a synthetic history and the configured model.
   Honor the separate Node dependency consent, then run
   `hermes emberfold setup --check --json`. Verify discovery, Plugin Doctor,
   plugin validation, and exact package integrity. If installation skipped Node
   dependencies, explicitly repair them with `setup --install-deps`; never
   download dependencies during conversation processing.
4. Exercise automatic and manual compression, at least five successive passes,
   continuation, exact recall, corruption refusal, rebuild, restart, and switching
   back to the previous engine. Verify original physical rows remain unchanged;
   compare message identity and content separately from active/archive flags.
5. Compare paired continuation scenarios with the built-in compressor and full
   history where it fits. Require exact protection, correction precedence, and
   uncertain-effect retention. Record actual tokens, token method, latency, and
   available usage, not a synthetic summary-quality score.
6. Only after acceptance, standard-install the same commit into the selected
   production home. Preserve stronger compression settings, other plugins, memory,
   credentials, channels, schedules, and unrelated profiles. Respect managed keys
   and mutation controls. Let current work finish; do not replay uncertain effects.
7. Run guided setup, restart only the resolved gateway with operator consent,
   then run a bounded synthetic session through the real runtime. Confirm the
   selected engine, healthy service, source recovery, and live code/dependency
   digests. Refresh any existing installation inventory using its normal path.
8. On a failed acceptance check stop adoption. Use `hermes emberfold rollback`,
   restart the same gateway, and verify the previous engine. Keep all subsequent
   messages and retained sources; never restore a stale whole database.

Operational proof should identify the release commit and code/dependency digests,
the exact privately recorded target/home, actual engine selection, acceptance
results, restart/rollback evidence, and unchanged sibling-profile/configuration
checks. Keep proof owner-only. Plugin discovery or a desired-state row alone is
not deployment acceptance. Catalog submission is a separate upstream action.

## Profile and supervisor boundaries

One gateway can multiplex several profiles. An isolated test home does not
authorize a second messaging poller. Before a shared-gateway restart, verify all
affected profiles have no active turns or compression locks. Preserve unrelated
configuration bytes and check their effective context engines after activation;
file equality alone cannot rule out inherited-setting changes.

Forced reinstalls may remove Node dependencies. Check and explicitly restore the
lockfile installation before restarting or sending a turn. Use the same selected
continuity profile when rerunning setup. Wait for native gateway readiness after
restart; a successful supervisor command alone does not prove RPC readiness.

Archive synthetic pilot state privately before cleanup. Hermes profile deletion
may stop a shared gateway; schedule it in the approved idle maintenance window,
then restart the same supervisor and verify production continuation and recall.
Never delete unrelated profiles or restore an old conversation database.

Discovery caches can report a recent heartbeat while still containing an older
plugin list. Keep cached inventory, installed digest proof, and native-session
activation evidence distinct. Record any inventory-refresh gap privately; do not
bypass managed mutation controls just to update a dashboard.
