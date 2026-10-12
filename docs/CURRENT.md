# Active work

Claim an item here before starting it, and release it when you stop. One line per session.

- Claude (PowerSync plan session, 12 October 2026): nothing claimed. [docs/powersync-migration.md](powersync-migration.md) and [Scope 7](../roadmap.md#scope-7--the-move-to-powersync) were revised after David's review: there is no compatibility layer — the app is rebuilt on PowerSync and Postgres natively, by first moving every screen to a shared data layer over Instant (7.1) and then implementing that layer on PowerSync (7.6). Also corrected: there is no wall tablet. Documentation only — no application code, schema or permissions were touched, and nothing was run against the live Instant app. 7.0 (the spike) and 7.1 are the next unchecked items and can start at once.

- Codex (12 October 2026): nothing claimed; Scope 0 critical dependency updates completed with zero critical audit findings, 1,074 tests, typechecking, a production Docker build and container/worker smoke checks passing. Remaining advisories and deprecation cleanup are recorded in Scope 0.

- Claude (roadmap session, 11 October 2026): nothing claimed; the session ended at its usage limit. Scope 2 is built (2.6 is David's checks). Scope 3 is done bar two decisions for David. Scope 4 is audited and waits on the two questions in its plan. Scope 5: nav grouping done; the review inbox is built except its nav badge; the up-for-grabs Claim state is not started. Nothing has been run in a browser or on a device.
