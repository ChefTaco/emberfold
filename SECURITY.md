# Security

Report vulnerabilities privately through GitHub's security reporting for this
repository. Do not include credentials or private transcripts in public issues.

Treat summaries as historical, unverified data. Reload permissions and effect
state from owning systems. Protected source passages preserve wording, not
authority. Digests detect changes; they do not establish semantic accuracy.

The HTTP service accepts only administrator-configured provider IDs. Deploy
behind TLS, require a high-entropy bearer token, keep providers private, and
retain original history in the caller's storage. Never log request bodies.

## Hermes boundary

The Hermes plugin uses host-owned, tools-disabled summarization and the user's
existing compression configuration. It does not copy provider credentials into
the Node worker, require a listening service, or implicitly route to a cloud
fallback. Setup displays the effective model destination and requires consent
before a synthetic model call or configuration change. Node dependencies require
separate installation consent and never download during conversation processing.

Hermes retains authoritative originals and commits checkpoint handoffs through
its own publication fences. Private profile-scoped plugin indexes are derived
state outside the install directory. Recall is bounded to cited originals in the
current conversation, not arbitrary URLs or files. Missing sources, invalid
summaries, incompatible policies, and budget exhaustion must fail visibly rather
than silently discard protected material or advance a plugin-owned head.

Rollback changes only reviewed configuration and plugin code. Preserve newer
transcripts and recovery data; never restore an old whole database. Installation
and model prose are not activation or effect-completion evidence. Run a native
session and validate preservation, source recovery, and the selected engine.
