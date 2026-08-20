# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.19.0

FROM scratch AS rds-certificate
ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  /global-bundle.pem

FROM node:${NODE_VERSION}-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/alert-worker/package.json apps/alert-worker/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/postgres/package.json packages/postgres/package.json
COPY packages/rentcast/package.json packages/rentcast/package.json
COPY packages/telegram/package.json packages/telegram/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install \
    --filter @chaoran-property-intelligence/alert-worker... \
    --frozen-lockfile

COPY apps/alert-worker apps/alert-worker
COPY packages packages

RUN pnpm build:runtime \
  && pnpm --filter @chaoran-property-intelligence/alert-worker \
    deploy --prod /deploy

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN install -d -m 0755 /app/certs

COPY --from=rds-certificate --chmod=0444 /global-bundle.pem /app/certs/global-bundle.pem
COPY --from=build --chown=node:node /deploy /app/apps/alert-worker

USER node

CMD ["timeout", "--signal=TERM", "15m", "node", "apps/alert-worker/dist/index.js", "--run"]
