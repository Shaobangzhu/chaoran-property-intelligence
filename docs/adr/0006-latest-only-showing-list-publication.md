# ADR 0006: Latest-Only Showing List Publication

## Status

Accepted

## Context

Block 18 will generate a Showing List draft in AWS once per week. Keeping a new
database snapshot or S3 object for every run would create unbounded storage
growth even though the current single-administrator product needs only the most
recent draft.

The administrator also needs the result without opening the web application.
The existing Telegram integration is an appropriate notification path, but the
artifact must remain private, links must expire, and a failed replacement must
not destroy the last usable draft.

## Decision

Use a latest-only publication model. Application-visible primary storage has:

- at most one current Showing List database row
- at most one private S3 artifact at a stable key such as
  `showing-lists/current.<format>`
- no append-only generation table, dated artifact key, S3 object version, or
  Object Lock retention

The dedicated artifact bucket remains unversioned and blocks public access. A
lifecycle rule aborts incomplete multipart uploads after a short bounded
period. The exact downloadable artifact format is selected with the Block 18.1
schema and output contract without changing the latest-only invariant.

The weekly schedule uses a dedicated EventBridge Scheduler target for a one-off
ECS Fargate Showing List task. It does not reuse, enable, or mutate the existing
`cpi-daily-property-alert` schedule. Weekday, time, time zone, and enabled state
are explicit deployment parameters. The task reads listing IDs and preferences
from one explicit current server-side generation configuration defined in Block
18.1 and never depends on transient browser state. Missing or invalid
configuration leaves the previous draft unchanged and sends no Telegram
message.

## Publication Sequence

The task performs one ordered workflow:

1. Load the current generation configuration, then reload authoritative listing
   data and bounded preferences.
2. Generate and validate the complete structured draft.
3. Render the complete downloadable artifact before touching current storage.
4. Overwrite the stable S3 key.
5. Upsert the singleton database row with the generation ID, object ETag,
   validated result, current lifecycle state, and delivery state.
6. Generate a short-lived presigned URL and send it to the configured
   administrator Telegram chat.

Generation, validation, rendering, or upload failure leaves the previous draft
and metadata unchanged and sends no Telegram message. S3 replacement of one key
is atomic, so a reader observes the old or new complete object rather than a
partial upload.

S3 and PostgreSQL do not provide one cross-service transaction. If the metadata
upsert fails after object replacement, the job fails and retries by the same
generation ID and ETag until the singleton metadata is reconciled. It never
creates a history object. Block 18.6.4 covers the application retry boundary;
Block 18.9 retains the cross-adapter integration-test gate.

Block 18.6.4 implements the first reconciliation boundary in the application
use case. A non-conflict metadata error receives one additional repository call
with the identical immutable payload while the generated envelope remains in
memory. That retry does not call the model, rerender, or upload the object again.
A generation identity conflict is not retried. If both metadata calls fail, the
future task must fail before Telegram delivery; any further retry must preserve
the same envelope and identity rather than regenerate content under the old ID.

## Telegram Delivery

Telegram delivery occurs only after the replacement and metadata commit. The
message says that the Showing List is an unreviewed draft and that its download
link expires.

The presigned URL:

- targets only the stable current key
- expires at the earlier of its configured duration or the task's temporary AWS
  credential expiry
- requests attachment content disposition
- is generated at delivery time and is never stored in PostgreSQL or logs

An older Telegram message can therefore resolve only to the current object
while its link is valid; it cannot expose a retained old artifact. Telegram
itself retains the message independently, but the URL loses access at expiry.

A Telegram failure does not roll back the successfully published draft. The
singleton row records `pending`, `sent`, or `failed` delivery state plus the
generation ID and sent timestamp. Bounded retries suppress ordinary duplicate
delivery after a confirmed send. A network timeout with an unknown Telegram
outcome remains a documented residual duplicate-message risk.

## Data Retention Boundary

Latest-only governs active application storage. It does not claim immediate
physical erasure from AWS-managed backups. Aurora may retain prior database
bytes during its configured seven-day backup window, and bounded CloudWatch
events remain for seven days. Logs contain no artifact body, customer message,
presigned URL, API key, bot token, or credential.

This keeps active draft storage constant while preserving the existing bounded
operational recovery and diagnostics policy.

## Review and Download Semantics

The current structured draft and generated PDF share one generation identity,
but Block 18.7 does not silently rerender the artifact when an administrator
edits structured content. Saving an edit atomically updates the singleton JSON,
resets lifecycle status to `draft`, and leaves the generated PDF snapshot and
ETag unchanged. Marking reviewed is allowed only against the exact saved
generation and update timestamp.

The authenticated browser download reads the singleton metadata first and uses
S3 `If-Match` with its ETag. This prevents a concurrent weekly replacement from
serving a new object as though it belonged to an older database read. The UI
labels the file as a generated snapshot. Edited-PDF publication, if required
later, needs its own explicit render, stable-key replacement, and metadata
reconciliation decision.

## Consequences

- a successful weekly run deliberately replaces the prior draft
- draft history, comparison, and rollback are not product features
- storage does not grow by one artifact and database row per week
- a failed run preserves the last usable draft
- Telegram gives the administrator direct temporary access without making S3
  public
- old Telegram links do not provide access to historical draft content
- model, Fargate, request, transfer, database backup, and log costs still exist
- future multi-user or audit-history requirements require a new ADR and explicit
  retention and cost review

## References

- [AWS S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [AWS S3 data consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
- [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [AWS lifecycle rule for incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)
