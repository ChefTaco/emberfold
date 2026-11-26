# Operations

## Optional HTTP service

The service is stateless. Keep authoritative history and checkpoint publication
inside the caller. Pass credentials through environment variable names in provider
configuration; do not put secret values in JSON or request bodies.

```json
{
  "host": "127.0.0.1",
  "port": 8096,
  "token_env": "EMBERFOLD_API_TOKEN",
  "default_provider_id": "local",
  "providers": [{
    "type": "http", "id": "local", "base_url": "https://model.example.com/v1",
    "model": "configured-model", "api_key_env": "LOCAL_MODEL_TOKEN",
    "input_tokens_path": "chat/completions/input_tokens"
  }]
}
```

An `http` provider with `api_key_env` must use `https:` unless its host is loopback
(`localhost`, `127.0.0.0/8` or `[::1]`), so the credential is never sent in clear
text across a network. A provider without a credential may still use plain HTTP.

### Routing through Emberpath

The opt-in `emberpath` provider type routes summarization through an Emberpath
gateway's OpenAI-compatible model API. It shares the `http` implementation and
sends `POST <emberpath>/v1/chat/completions` with `Authorization: Bearer <client key>`.
Existing `http` and `codex` providers are unchanged.

```json
{
  "default_provider_id": "emberpath",
  "providers": [{ "type": "emberpath", "id": "emberpath", "model": "configured-model" }]
}
```

| Field | Default | Meaning |
|---|---|---|
| `model` | required | Model name or Emberpath route to request. |
| `base_url` | unset | Explicit Emberpath root URL. Overrides `base_url_env`. |
| `base_url_env` | `EMBERPATH_URL` | Environment variable holding the Emberpath root URL. |
| `api_key_env` | `EMBERPATH_API_KEY` | Environment variable holding the Emberpath client API key. |
| `input_tokens_path`, `timeout_ms` | unset | Same as the `http` provider. |

The URL is the Emberpath root, for example `https://emberpath.example.com`;
`/v1` is appended unless the path already ends in `/v1`. HTTPS is required
except for loopback hosts. Startup fails when the URL or key is missing.

Create a dedicated client key per caller so Emberpath attributes its traffic.
Emberpath attributes requests whose key metadata carries `actorId`:

```bash
emberpath create-key --name "emberfold" --metadata '{"actorId":"emberfold","service":"emberfold"}'
```

(`hive-router create-key` is the same Emberpath command under its older name.)

Use the actor ID the rest of the suite knows this caller by (for an agent, its
agent ID). The plaintext key is printed once; store it only in the variable named
by `api_key_env`. Keys enrolled through Emberpath's actor credential flow already
carry `actorId`.

Use a high-entropy bearer token of at least 32 characters. The service can also
accept Oathweave client-credentials tokens, so each caller has its own identity:

```json
"oathweave": {
  "issuer": "https://identity.example.com", "native_issuers": ["hive-iam"],
  "jwks_url": "https://identity.example.com/.well-known/jwks.json",
  "audience": "emberfold", "scope": "emberfold:context"
}
```

A token is accepted only when it is an RS256 service token for exactly that
`audience`, from a listed issuer, and carries `scope` in its `scope` claim or its
`permissions`. A valid token without it gets `403 FORBIDDEN`; key discovery that
fails gets a retryable `503 AUTH_UNAVAILABLE`. User tokens are refused. The static
bearer keeps working, and request logs record the caller (`static`, or the service
subject and client ID). `issuer` and `jwks_url` must use HTTPS. Only configured provider
IDs are accepted. Remote access requires a TLS reverse proxy; the host-side
container port is bound to loopback. Health probes reveal no prompts or secrets.
Default limits: 16 MiB request body, two concurrent requests, 120-second deadline.

Unauthenticated health follows the suite paths `/health/live` and `/health/ready`
(the original `/healthz` and `/readyz` bodies are unchanged). Every response carries
`X-Request-Id`, taken from the caller's `X-Request-Id` when valid. The service logs one
JSON line per API request on stderr with the operation, status, duration, request and
trace IDs, the error code if any, and the caller's `x-hive-execution` attribution
(`root`, `parent`, `self`) when present. Attribution is never authority. Bodies,
tokens and query strings are not logged.

`GET /metrics` requires the service bearer token (in Prometheus, use
`authorization: { credentials_file: ... }`). It exports
`emberfold_requests_total{operation,status}`, the
`emberfold_request_duration_seconds` histogram, `emberfold_compactions_total`,
`emberfold_provider_failures_total{code}`, `emberfold_requests_in_flight` and
`emberfold_ready`. Counters reset when the process restarts.

`npm run deploy -- preflight` reads the ignored root `.env` using
`DEPLOY_HOST`, `DEPLOY_USERNAME`, and `DEPLOY_PASSWORD`; optional `DEPLOY_PORT` and
`DEPLOY_TLS_PORT` (defaults `8096` and `8097`) set the service and TLS ports. Passwords travel on
dedicated file descriptors/stdin, never as process arguments or diagnostic output.
`deploy`, `status`, `restart`, and `rollback` operate on an immutable image digest.
Set optional `DEPLOY_DNS` to a trusted resolver IP when container networking needs
private DNS. Releases snapshot the previous provider configuration and environment
privately and restore both together with the previous image during rollback.
Set `DEPLOY_IMAGE=ghcr.io/cheftaco/emberfold@sha256:VERIFIED_DIGEST` to deploy the
published artifact instead of building from the clean checkout. Mutable image
tags are rejected. Receipts record both the deployment-source revision and the
actual image ID and registry reference.
Keep configuration and receipts under ignored `output/deploy/` and on the host.

Do not deploy a failed build. Verify anonymous denial, authenticated preparation,
restart, and rollback before promotion. Ardent upgrades additionally require a
dedicated pilot, source/journal preservation, and sequential profile acceptance.
Do not replay queued, failed, sealed, or uncertain effects during verification.
Check [Ardent and Magnus compatibility and managed ownership](MAGNUS.md) before resuming an
Ardent rollout after a control-plane upgrade. A healthy service or successful
node-manager upgrade is not per-profile acceptance.

Releases use Emberfold's own `Publish` workflow: a `v*` tag runs `npm run verify`,
publishes the three npm packages through trusted publishing with provenance, then
builds and attests the service image.

Registry acceptance is not installation proof: npm scans newly published packages
before serving them. The release script submits each artifact once, then polls
read-only integrity checks for up to twenty minutes per artifact. If scanning is
still pending, inspect registry availability before running publication again.

The optional Codex adapter uses the local tools-disabled stdio app-server and
existing owner authentication. The child process receives only the variables it
needs (`HOME`, `PATH`, locale, temporary and XDG directories, CA and proxy settings,
and `CODEX_*`; `OPENAI_API_KEY` and `OPENAI_BASE_URL` only with `auth_mode: "apiKey"`),
never the service token or other providers' credentials. The protocol is pinned by tests and verified
against the installed binary. Reference: [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Hermes plugin

Hermes uses the local `emberfold-hermes` plugin, not the optional service or its
deployment credentials. Start with [guided onboarding](../integrations/emberfold-hermes/README.md)
and the [profile-scoped adoption checklist](../integrations/emberfold-hermes/DEPLOYMENT.md).
Hermes owns model authentication, transcripts, compression commits, and session
lifecycle. The plugin's private indexes are recoverable derived state, not an
alternative conversation database. Do not restore an old database for rollback.

Record installed, configured, active, and healthy states separately. Keep native
session evidence and installed digests distinct from cached management inventory.
Run the isolated pilot before selecting a production home; preserve stronger
existing protection settings and leave unrelated profiles and memory providers
unchanged. Configuration and plugin-version rollback never discard newer messages.

## Independent release streams

The library, JSON CLI, and service are at `0.5.0`; the service image is a
linux/amd64 and linux/arm64 index with a build provenance attestation. Its
runtime stage ships only Node: npm, npx, Corepack, Yarn, and apt are removed,
so install nothing inside a running container. Hermes plugin `0.1.1` is
published independently as
[`hermes-v0.1.1`](https://github.com/ChefTaco/emberfold/releases/tag/hermes-v0.1.1)
at `416b6fb66149ac17fbca54cb46ec79f39214d647`, with an exact core `0.1.0`
dependency. Use that release's copy-ready full-commit installation instructions,
metadata, archive, and SHA-256 checksums. Hermes plugin `0.1.0` is superseded for
gateway adoption; its immutable tag and artifacts remain available.

For another plugin release, verify both supported Node lines, Plugin Doctor,
Hermes validation, packaged installation, and model-backed native acceptance.
Tag the verified source with a new `hermes-v*` version and publish sanitized
metadata containing the full source commit, exact dependency identities, tested
Hermes revisions, and artifact checksums. Download and verify the published
artifacts before adoption. Retain private acceptance and rollback receipts.

The core `Publish` workflow handles `v*` tags, not `hermes-v*` component tags.
A plugin-only release must not republish the unchanged npm packages or service
image. Never overwrite any published version, release tag, or artifact to amend
a failed acceptance; ship a new version and clearly supersede the old one.
