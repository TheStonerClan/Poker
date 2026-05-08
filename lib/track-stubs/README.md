# Track stubs

The admin app (Track B) imports these stubs in place of the real
`/lib/prize-math`, `/lib/color-up`, and `/lib/recurrence` packages while
those tracks are still developed in parallel. Each module re-exports the
public API the admin UI consumes and provides plausible mock results so
the UI is testable without those packages being merged.

When tracks D / E / F land on `main`:

1. Wire `pnpm-workspace.yaml` to include `lib/prize-math`, `lib/color-up`,
   and `lib/recurrence` (and add them as dependencies in the root
   `package.json`).
2. Replace the imports throughout `app/admin/**` from
   `@/lib/track-stubs/*` to the real package names.
3. Delete this directory.

Until then, do NOT modify the real `/lib/prize-math`, `/lib/color-up`, or
`/lib/recurrence` source — those packages live on their own branches.
