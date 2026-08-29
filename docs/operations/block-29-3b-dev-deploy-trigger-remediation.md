# Block 29.3b DEV Deploy Trigger Remediation

## Incident

After pull request 12 merged Block 29.3a into `dev` at commit `759016c`, Deploy
DEV run 8 completed release verification but GitHub rejected the first
`development` environment job before a runner started:

```text
Branch "refs/pull/12/merge" is not allowed to deploy to development due to
environment protection rules.
```

No AWS credentials were issued to the rejected job. No account-backed CDK
diff, CloudFormation deployment, migration, scheduler operation, or database
access occurred.

## Root Cause

The workflow used `pull_request` with the `closed` event. Although the pull
request target was `dev`, GitHub evaluated the deployment against the synthetic
pull-request merge ref. The `development` environment correctly permits only
the protected `dev` branch and rejected that ref.

The environment rule is not defective and must not be broadened to accept
`refs/pull/*`.

## Remediation

- Replace `pull_request: closed` with `push`, restricted to `dev`.
- Retain manual dispatch, but continue to reject dispatches from any ref other
  than `refs/heads/dev`.
- Retain both existing `development` environment approval jobs.
- Continue checking out the immutable event SHA in verify, plan, and deploy.
- Add a workflow contract test that rejects reintroduction of a pull-request
  deployment trigger.

For a protected `dev` branch, merging a pull request produces the qualifying
push event and GitHub evaluates the environment against `refs/heads/dev`.

## Authorization Boundary

This source change does not authorize a workflow dispatch, environment
approval, AWS OIDC session, CDK diff, deployment, migration, smoke test against
AWS DEV, or any production action. Those remain separate owner-controlled
operations.

## Verification Results

- focused DEV deployment workflow tests: 6 passed
- full test suite: 1,289 passed across 133 files
- full typecheck: passed
- production build: passed with the existing Vite large-chunk warning
- workflow YAML parse: passed
- `git diff --check`: passed

The first sandboxed full-test attempt could not bind API integration tests to
`127.0.0.1`. The unchanged suite was rerun with local loopback permission and
all tests passed. No external endpoint was contacted.

The first post-merge run must still stop at approval 1 until its account-backed
DEV diff has been reviewed and explicitly authorized.
