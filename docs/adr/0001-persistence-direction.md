# ADR 0001: Persistence Direction

## Status

Accepted

## Context

The first phase of this project is a Telegram listing alert worker. The long-term
product is a real estate intelligence system with a React map, showing list,
school proximity, and wildfire hazard overlays.

The persistence layer will eventually need to support:

- listing points
- school points
- wildfire hazard polygons
- distance queries
- point-in-polygon queries
- deduplication keys
- notification status and retry state
- baseline initialization markers

## Decision

Use PostgreSQL with PostGIS as the long-term persistence direction.

Do not add a concrete database implementation in this block. The repository port
should be introduced later when the `CheckNewListings` application use case needs
it and can drive the interface through tests.

## Options Considered

### MongoDB with GeoJSON and 2dsphere indexes

MongoDB is a good fit for flexible document storage and can store GeoJSON points
and polygons. Its `2dsphere` indexes support geospatial operations such as
nearby searches, within-polygon queries, and geometry intersection queries.

Advantages:

- flexible document model for changing external API payloads
- straightforward storage of raw or semi-normalized listing records
- GeoJSON support is built in
- good MVP speed if the app mostly stores and retrieves listing documents

Trade-offs:

- complex spatial joins are less natural than SQL joins
- stronger data integrity often moves into application code
- future multi-layer analysis can become harder to express
- GeoJSON coordinate order is longitude first, latitude second, which is easy to
  get wrong

### PostgreSQL with PostGIS

PostgreSQL is a strong fit for relational workflow state, and PostGIS adds mature
geospatial types, indexes, and functions.

Advantages:

- good fit for deduplication keys, notification status, retry state, and
  baseline markers
- `ST_DWithin` supports distance queries such as listing-to-school distance
- `ST_Within`, `ST_Contains`, and `ST_Intersects` support point-in-polygon and
  layer intersection queries
- GiST spatial indexes are a mature path for performance
- future Express API queries can combine listing state, notes, favorites,
  showing status, and geospatial filters in one query model

Trade-offs:

- heavier initial setup than a document database
- requires schema migrations
- requires care around geometry vs geography, SRID, and units
- local development will likely need Docker or a managed development database

## Consequences

The MVP will keep domain and application logic independent from any concrete
database. We will introduce repository interfaces before adding persistence
implementation code.

When persistence is implemented, prefer:

- normalized relational tables for listings and workflow state
- PostGIS point columns for listing and school coordinates
- PostGIS polygon or multipolygon columns for wildfire hazard zones
- unique constraints for idempotency and deduplication keys
- explicit migrations checked into the repository

## Deferred Work

This ADR does not create:

- a database client
- repository interfaces
- SQL migrations
- Docker Compose
- production database configuration

Those should be introduced in later blocks when the application use case and
deployment shape make the required boundary clearer.
