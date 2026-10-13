# Moving your own copy off InstantDB

**For:** anyone running their own copy of this app. **Status, 13 October 2026:** the part that moves your data is built and you can try it on your data today. The app itself is not finished moving, so you cannot switch yet; this guide gains its last steps when it is ([Phase 9](powersync-migration.md#phase-9--cleanup)).

Instant Cloud stops on **31 August 2027**. This app is moving to Postgres, with PowerSync keeping each device in step ([why and how](powersync-migration.md)). Your data moves by an export and an import that you run yourself, on your own machine. Nobody else looks at your data and nothing here needs anyone's judgement but yours.

## What the import decides for you, and how

It was written so that it cannot lose something without saying so.

- **Everything in your export is accounted for.** Every entity and every attribute is carried into a column, or left behind on purpose and named, with the reason, in the import's output. The list of what is left behind, and why, is at the top of `scripts/migrate/mapping.mjs`.
- **Something it has never heard of stops it.** If your copy of the app added an entity or an attribute, the import names it and loads nothing. You then map it, list it as left behind, or run again with `--leave-unknown-behind` to say you mean to lose it.
- **A row the new database cannot hold is held back, never dropped.** The new schema says things Instant did not: a completion belongs to a chore, an update to a task, a person is in a thread once. A row that breaks one of those — nearly always something left over from a thing since deleted — is written to a file beside the import's report with the reason, and counted in the output. You can read it, and if you want it kept, mend it in Instant and export again.
- **Where two records disagree, a rule decides and the output says how often.** One default envelope for each person, the first as the app reads them. One tag of a name. The newest of two answers to the same question. Each is a line under "Conversions", with a count.
- **A check that shares no code with the import then compares the two.** It works out what should be in Postgres from your export's raw files and compares field by field, money included: every envelope's ledger must add up to the same total before and after, with no rounding. It exits with an error if anything differs.

## Try it on your data today

You need a checkout of this repository with `npm ci` run, and the `.env` your app already has, with `INSTANT_APP_ID` and `INSTANT_APP_ADMIN_TOKEN`. Nothing else is installed and nothing is changed anywhere.

```bash
node scripts/migrate/export.mjs
```

Reads every entity of your Instant app and writes it under `.migration/exports/`. It can only read: the script is built so that it cannot reach a write.

```bash
node scripts/migrate/rehearse.mjs
```

Loads that export into a Postgres that lives only inside the command, runs the check, and throws the database away. It prints how many rows go into each table, what would be held back and why, what was converted, and the result of every check. It ends with one of:

- `This export will import, whole.`
- `This export will import. N rows will be held back…`
- a list of what it does not know, or of the checks that failed. Either is worth an issue on this repository; the output holds counts, names of attributes and ids, and never a value you stored.

`.migration/` holds your family's data in plain text. Git ignores it. Do not commit it, and do not paste its files anywhere.

## The move itself

Not possible yet. When it is, the steps will be here, and they are short: add Postgres and the PowerSync service to your deployment, which `docker-compose.yml` already describes under a profile; send one path on your app's address to the sync service from your reverse proxy; stop writes; export; import; run the check; switch the app over; and set up the nightly backup, because Instant Cloud will no longer be keeping one for you. [The cutover protocol](powersync-migration.md#the-cutover-protocol) is the design.

What you can usefully do before then is run the two commands above once, so that anything your data has that this family's did not is found now and not on the day.
