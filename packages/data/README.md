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

## Two kinds of area

The first areas — settings, units, the family roster's read, the chore day — were written before 13 October 2026, when the plan was to move every old screen onto this layer. Each has a `backend.ts`, an implementation over InstantDB in `instant/` and one over PowerSync in `powersync/`, chosen at startup, because old screens on the live app read through them. The InstantDB side and the seam between the two are deleted when the app has moved.

Every area since is written once, on PowerSync, because the screens that use it are new and run nowhere else. Its `hooks.ts` and `mutations.ts` read and write the signed-in person's local database directly, through `powersync/current.ts`, with nothing in between. Nothing is ever written to make PowerSync look like InstantDB.

## Rules

- A type here is chosen because it is right for a relational schema, not because Instant returned it that way: ids for references, ISO strings for instants, `YYYY-MM-DD` for days, real booleans.
- A read is named for what a screen needs (`useSetting`), not for a table.
- A write is a named function (`saveSetting`), not a list of operations.
- Each platform binds a backend once at startup: `lib/data.ts` on the web, `mobile/src/lib/data.js` on the phone. Screens import from those.
