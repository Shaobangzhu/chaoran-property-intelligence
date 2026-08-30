# Block 29.3c Pre-Deployment Evidence Query Remediation

## Incident

Deploy DEV run 9 was triggered from protected `dev` commit
`73ed236da983b2db5688c62911984ff0c4a0edf2`. Release verification and the first
environment-approved account-backed plan completed successfully. After the
second environment approval, the deployment job failed while capturing
pre-deployment rollback evidence.

The shell interpreted the JMESPath pipe and index in the App Runner query as
shell syntax because the workflow escaped the query's double quotes inside a
command substitution. The resulting errors were:

```text
[0]: command not found
Bad jmespath expression: Unclosed " delimiter
```

## Impact And AWS State

The failure occurred before the CDK application build and before every
mutation-bearing step. Run 9 did not execute:

- CDK deployment
- App Runner update or restart
- DEV migration runner
- S3 publication or CloudFront invalidation
- remote smoke tests

The job used temporary OIDC credentials only for bounded account validation
and read-only pre-deployment evidence calls. No production operation was
attempted.

## Root Cause And Remediation

Three AWS CLI queries used the same fragile escaped-double-quote pattern:

- pre-deployment App Runner evidence
- post-deployment App Runner evidence
- deployment-failure SNS topic discovery

All three now use shell single quotes around the complete JMESPath expression
and JMESPath backtick literals for compared string values. This keeps the pipe,
index, and comparison inside one AWS CLI argument.

The workflow contract test now rejects escaped quote prefixes on AWS CLI
queries and requires the corrected App Runner and CloudFormation expressions.

## Authorization Boundary

This source remediation does not authorize rerunning run 9, approving a new
deployment, executing a migration, or changing AWS resources. Rerunning run 9
would retain the old workflow source and must not be used. The fix must merge
through the protected `dev` branch, after which the new exact SHA requires a
fresh plan review and separate deployment approval.

## Verification Results

- focused DEV deployment workflow tests: 7 passed
- shell syntax validation: all 30 workflow `run` scripts passed `bash -n`
- full test suite: 1,290 passed across 133 files
- full typecheck: passed
- production build: passed with the existing Vite large-chunk warning
- workflow YAML parse: passed
- `git diff --check`: passed
