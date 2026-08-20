# ADR 0002: AWS Deployment Foundation

## Status

Accepted

## Context

The alert worker is a short-lived daily batch process. It needs outbound HTTPS
access to RentCast and Telegram, private PostgreSQL access, durable state, secret
injection, logs, and a predictable execution limit. The project has AWS credits,
but recurring infrastructure cost still matters.

## Decision

Deploy the worker as an EventBridge Scheduler target that launches one ECS
Fargate task. Store application secrets in AWS Secrets Manager and persistence
state in Aurora PostgreSQL Serverless v2. Define the complete foundation in
TypeScript with AWS CDK.

The VPC uses public subnets for the Fargate task and isolated subnets for Aurora.
It has no NAT gateway. The task receives a public IP for outbound API calls but
has no inbound security-group rules. The database accepts PostgreSQL traffic
only from the task security group.

The task uses the AWS RDS global certificate bundle and
`PGSSLMODE=verify-full`. Its hard runtime limit is 15 minutes. Logs are retained
for seven days.

Aurora is encrypted, has deletion protection and seven-day backups, and is
retained with its credentials secret if the stack is removed. Its Serverless v2
capacity range is 0 to 1 ACU, with automatic pause after five idle minutes.

The scheduler is created disabled by default. Block 13 must configure real
secret values, establish cost alerts, review the synthesized change set, and
receive explicit confirmation before provisioning or enabling the schedule.

## Options Considered

### AWS Lambda

Lambda fits a scheduled short-running job, but this worker currently uses a
normal PostgreSQL TCP client and a containerized Node.js composition root. A
private database plus public third-party API access would require another
networking or database-access design. Fargate preserves the tested runtime model
with fewer application changes.

### Fargate with a NAT gateway

A private Fargate task behind a NAT gateway is a conventional topology, but the
gateway creates a fixed recurring cost that is disproportionate to one daily
task. A public-IP task with no inbound rules provides the required egress while
the database remains isolated.

### Always-running ECS service or EC2 instance

An always-running process is unnecessary for a once-daily batch and would spend
credits continuously. A one-off scheduled task matches the workload.

## Consequences

- CDK synthesis and contract tests can validate the architecture before any AWS
  account mutation.
- Aurora resume latency is possible after automatic pause, so the PostgreSQL
  client allows a 60-second connection attempt.
- The public Fargate task has internet egress. Its lack of inbound rules and
  short lifetime reduce exposure, but outbound controls remain intentionally
  simple for the MVP.
- Scheduler retries and its dead-letter queue cover target invocation failures;
  they do not automatically retry a container that starts and later exits with
  an error. Block 13 must verify ECS stopped-task visibility and alerting.
- Secrets Manager, Fargate, Aurora, public IPv4, logs, and related AWS services
  can incur charges. Cost alarms and a teardown drill are Block 13 prerequisites.
- Retaining Aurora and its credentials protects production data but means stack
  deletion alone does not guarantee zero ongoing cost. Teardown documentation
  must include both retained resources.

## Deferred Work

- AWS account bootstrap and resource deployment
- GitHub Actions OpenID Connect deployment role
- production secret population and rotation
- scheduler enablement
- cost alerts and runtime failure alerts
- first controlled production baseline execution
