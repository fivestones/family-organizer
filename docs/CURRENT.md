# Active work

Claim an item here before starting it, and release it when you stop. One line per session.

- Claude (PowerSync session, 13 October 2026): nothing claimed. Scope 7.2, the slice, is built and tested on one machine except the phone: the tables with their import and verification, Postgres and PowerSync behind a compose profile, sessions, the write rules and upload route, the data layer on a device, the session manager, and a web client at `/sync`. `npm run test:sync:live` and `npm run test:sync:e2e` run it against the real sync service in Docker. It waits on David: a staging hostname (`docs/powersync-staging.md`), his devices, and a look at the live app after the root layout change. **Next for an agent: the phone's binding for the slice, then revising the later phases of the specification.** The specification's log has each step.

- Codex (12 October 2026): nothing claimed; Scope 0 critical dependency updates completed with zero critical audit findings, 1,074 tests, typechecking, a production Docker build and container/worker smoke checks passing. Remaining advisories and deprecation cleanup are recorded in Scope 0.

- Claude (roadmap session, 11 October 2026): nothing claimed; the session ended at its usage limit. Scope 2 is built (2.6 is David's checks). Scope 3 is done bar two decisions for David. Scope 4 is audited and waits on the two questions in its plan. Scope 5: nav grouping done; the review inbox is built except its nav badge; the up-for-grabs Claim state is not started. Nothing has been run in a browser or on a device.
