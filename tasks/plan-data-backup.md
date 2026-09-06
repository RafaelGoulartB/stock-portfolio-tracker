# Data settings and portable backups

## Goal

Move development test-data generation into a dedicated **Data** settings
section and add account-scoped export, import, and delete-all operations.

## Backup contract

- File extension: `.jsonl.gz`.
- Encoding: UTF-8 newline-delimited JSON compressed with gzip.
- The first line is a manifest with a stable format name, schema version,
  export timestamp, and row counts by entity.
- Data lines identify their entity and carry one row. Decimal database values
  remain strings and dates use ISO representations.
- The final line carries a SHA-256 checksum of every preceding uncompressed
  line, including its newline.
- Exported data is scoped to the authenticated account. Password hashes,
  sessions, and the source user ID are never included.
- Database IDs that are not part of the domain are omitted. Category references
  use a portable export-only key and are remapped to new IDs during restore.

## Performance and integrity

- Export reads PostgreSQL with cursors from a repeatable-read, read-only
  transaction and writes a backpressure-aware stream. It does not accumulate
  the full dataset in API or browser memory.
- Import decompresses and parses the request incrementally, validates every
  line, and inserts bounded batches.
- Restore uses one database transaction. Existing account data is deleted only
  inside that transaction; malformed data, count mismatches, duplicate keys,
  broken references, checksum errors, or database failures roll everything
  back.
- Import is replacement-only in v1. Merge semantics are deliberately excluded
  because silent deduplication is unsafe for financial records.
- The browser uploads the selected `File` directly and downloads through normal
  navigation, allowing browser/network streaming.

## API and safety

- `GET /api/data/export` streams the authenticated account backup.
- `POST /api/data/import` requires the gzip media type and an explicit replace
  confirmation header.
- `data.summary` reports row counts for the settings UI.
- `data.deleteAll` requires an exact `DELETE` confirmation value and removes
  all portfolio entities atomically, while keeping the login account.
- Import and delete actions have explicit destructive confirmations in the UI.

## Extensibility

Every future user-owned table must be added to the manifest counts, exporter,
row schema, importer order, and delete order. A format change increments the
integer schema version; older readers must reject unsupported versions rather
than partially importing them. A future migration layer can add explicit
version-to-version transformations without changing stored v1 backups.

## Verification

- Unit-test the backup envelope/parser and checksum behavior.
- Typecheck API and web, run API tests, compile translations, and build the web
  app.
