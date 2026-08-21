# Create a Local Administrator

## Scope

Use this runbook to create the initial administrator in the local Docker
PostgreSQL database. The command writes to the configured database and runs all
bundled migrations before inserting the user. Do not use it against AWS or any
remote database without a separately reviewed private connection path and
explicit operational approval.

## Preconditions

1. Use Node.js 24 and pnpm 11.19.0.
2. Start the local PostgreSQL container.
3. Confirm `.env.local` contains `DATABASE_URL` and remains ignored by Git.
4. Print only the parsed host and database name, never the full connection
   string:

```bash
node --env-file-if-exists=.env.local -e 'const u=new URL(process.env.DATABASE_URL); console.log({host:u.hostname,port:u.port,database:u.pathname.slice(1)})'
```

Stop if the host is not `localhost`, `127.0.0.1`, or `::1`.

## Create the User

Run the command with the administrator email:

```bash
pnpm user:create-admin -- --email admin@example.com
```

The CLI asks for the password twice with masked terminal input. The password:

- is normalized with Unicode NFC but is never trimmed
- must contain 15-128 Unicode code points
- may contain spaces and Unicode
- has no character-composition requirement
- must not match the bounded common or context-specific blocklist

The CLI never prints the password or password hash. On success it prints only
the normalized email. A duplicate normalized email fails without replacing the
existing account.

## Verification

Use the local PostgreSQL client or container to select only non-secret fields:

```sql
SELECT id, normalized_email, role, status, created_at, updated_at
FROM users
ORDER BY created_at;
```

Do not select, print, or copy `password_hash` during routine verification.

## Argon2id Baseline

Block 16.2 benchmarked `argon2@0.45.1` with `19 MiB`, two iterations, and
parallelism one. Five sequential samples produced:

| Environment | Hash average / maximum | Verify average / maximum |
| --- | --- | --- |
| macOS ARM64, Node 24.19.0 | 15.9 ms / 16.2 ms | 15.8 ms / 15.9 ms |
| Debian Linux ARM64 container, Node 24.19.0 | 15.1 ms / 18.7 ms | 13.7 ms / 15.3 ms |

These measurements confirm the accepted baseline remains comfortably below the
one-second target on the tested development and production-container shapes.
They are evidence, not a CI timing threshold.
