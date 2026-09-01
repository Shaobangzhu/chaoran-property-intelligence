# Block 29 Completion Record

## Status

Block 29 is complete as of 2026-09-01. The repository owner accepted the
generated CloudFront hostname as the supported Production entry point and
deferred the optional custom-domain phase. The operational handoff evidence is
consolidated in this record instead of creating a separate implementation
phase.

This record contains bounded release metadata only. It contains no credential,
secret value, session, private listing payload, database row, or production
request/response body.

## Final Production Release

- Application URL: `https://d1ayoi79dg623p.cloudfront.net`
- Exact `main` SHA: `f40c3428265b654f40407af52c46ab276c28b3bb`
- Production plan run: `33551815868`
- Reviewed approval digest:
  `0e57f6328b7098ca24bbc7876eb86cdcd428241f8d8230fa135f986bf1bcfaf7`
- Production deploy run: `33552752664`
- Reviewed diff: `CREATE 0 / UPDATE 2 / REPLACE 0 / DELETE 0`

The two reviewed updates changed only the App Runner release identity and the
CloudFront response headers policy. The protected deploy reproduced the exact
approval digest, deployed the four explicit stacks with both worker schedules
disabled, published the immutable Web build, reached bounded API readiness,
passed safe read-only Production smoke, and captured post-deployment evidence.

## Administrator And Browser Acceptance

The separately protected Production administrator workflow completed its plan
in run `33471930889` and its digest-bound create operation in run
`33472510162`. The temporary credential secret was deleted according to the
reviewed workflow evidence. The repository owner then completed the bounded
manual authenticated acceptance.

After the final CloudFront policy deployment, the repository owner manually
verified the Production workspace, listing markers, 2D basemap, 3D terrain, and
wildfire hazard overlay. ArcGIS browser requests now receive the Production
origin required by the referrer-restricted browser credential.

## Closure Decisions

- `29.7` is deferred. A custom domain is not required for the supported launch;
  any future ACM, CloudFront alias, and DNS work remains a separately designed
  and approved change.
- `29.8` is satisfied by this consolidated closure record. No additional
  runtime, infrastructure, AWS, or production-data mutation is required for
  handoff.
- Protected GitHub environments, exact-SHA release gates, account-backed plans,
  approval digests, disabled schedules, and separate administrator workflows
  remain the operating contract after Block 29.

## Accepted Follow-Ups

- Human confirmation of notification delivery remains a recurring operational
  check; the budget and failure-notification infrastructure remains deployed.
- Production administrator credential recovery or reset remains intentionally
  unimplemented.
- A friendly hostname may be added later as an optional product decision.
- CloudFront invalidation readiness can be hardened independently if future
  deployments expose waiter-duration sensitivity.

These follow-ups do not block the accepted generated-hostname Production
launch.

## References

- [Block 29 knowledge base](../knowledge-base/block-29-aws-public-launch-and-operational-readiness.md)
- [Block 29 launch runbook](../runbooks/block-29-aws-public-launch.md)
- [Production deployment record](block-29-6d-production-deployment-record.md)
- [Production administrator preparation](block-29-6f-production-admin-bootstrap-preparation.md)
- [Final Production plan run](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33551815868)
- [Final Production deploy run](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33552752664)
- [Production administrator plan run](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33471930889)
- [Production administrator create run](https://github.com/Shaobangzhu/chaoran-property-intelligence/actions/runs/33472510162)
