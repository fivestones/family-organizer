# The data layer

Every read and write the web app and the phone make goes through this package. Screens import hooks and mutations from here and nothing else; they hold no queries.

It exists because of the move from InstantDB to PowerSync, specified in [docs/powersync-migration.md](../../docs/powersync-migration.md). Read that first.

## Shape

```
src/
  backend.ts        the one seam: which implementation is active
  query-result.ts   what every read hook returns
  <area>/
    types.ts        the area's own types, designed for the relational schema
    backend.ts      what an implementation of the area must provide
    hooks.ts        live reads, named for what a screen needs
    mutations.ts    named writes
  instant/          the implementation over InstantDB — temporary
```

An area's `types.ts`, `hooks.ts` and `mutations.ts` know nothing about any database. Its `backend.ts` is the smallest interface that lets them work.

## The two implementations

`instant/` implements each area over InstantDB so the app keeps running on its live database while screens move here. It is the only place adapter code lives, it faces Instant, and it is deleted once the app has moved. A PowerSync implementation of the same interfaces runs beside it until then. Nothing is ever written to make PowerSync look like Instant.

The seam between the two is scaffolding as well. When the Instant implementation is deleted, each area's `backend.ts` and the registry in `src/backend.ts` go with it, and the hooks and mutations call the SQL directly.

## Rules

- A type here is chosen because it is right for a relational schema, not because Instant returned it that way: ids for references, ISO strings for instants, `YYYY-MM-DD` for days, real booleans.
- A read is named for what a screen needs (`useSetting`), not for a table.
- A write is a named function (`saveSetting`), not a list of operations.
- Each platform binds a backend once at startup: `lib/data.ts` on the web, `mobile/src/lib/data.js` on the phone. Screens import from those.
