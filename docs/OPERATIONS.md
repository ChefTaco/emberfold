# Operations

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
    "type": "http", "id": "local", "base_url": "http://model.example.com:8000/v1",
    "model": "configured-model", "api_key_env": "LOCAL_MODEL_TOKEN",
    "input_tokens_path": "chat/completions/input_tokens"
  }]
}
```

Use a high-entropy bearer token of at least 32 characters. Only configured provider
IDs are accepted. Remote access requires a TLS reverse proxy; the host-side
container port is bound to loopback. Health probes reveal no prompts or secrets.
Default limits: 16 MiB request body, two concurrent requests, 120-second deadline.

`npm run deploy -- preflight` reads the ignored root `.env` using
`DEPLOY_HOST`, `DEPLOY_USERNAME`, and `DEPLOY_PASSWORD`. Passwords travel on
dedicated file descriptors/stdin, never as process arguments or diagnostic output.
`deploy`, `status`, `restart`, and `rollback` operate on an immutable image digest.
Set optional `DEPLOY_DNS` to a trusted resolver IP when container networking needs
private DNS. Releases snapshot the previous provider configuration and environment
privately and restore both together with the previous image during rollback.
Keep configuration and receipts under ignored `output/deploy/` and on the host.

Do not deploy a failed build. Verify anonymous denial, authenticated preparation,
restart, and rollback before promotion. Ardent upgrades additionally require a
dedicated pilot, source/journal preservation, and sequential profile acceptance.
Do not replay queued, failed, sealed, or uncertain effects during verification.

Initial npm publication may use the maintainer's existing protected bootstrap
workflow in the upstream repository, pinned to an exact Emberfold commit. Its
credential is exposed only to publication. Cross-repository bootstrap omits
provenance rather than attesting the wrong source repository. Subsequent releases
use Emberfold's own workflow and trusted publishing after publisher setup.

Registry acceptance is not installation proof: npm scans newly published packages
before serving them. The release script submits each artifact once, then polls
read-only integrity checks for up to twenty minutes per artifact. If scanning is
still pending, inspect registry availability before running publication again.

The optional Codex adapter uses the local tools-disabled stdio app-server and
existing owner authentication. The protocol is pinned by tests and verified
against the installed binary. Reference: [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).
