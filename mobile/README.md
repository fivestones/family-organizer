# Family Organizer Mobile (Expo)

This is the iOS/Android mobile client scaffold for Family Organizer.

## Status

- Phase 0 foundation scaffold created
- Mobile backend API endpoints added under `/api/mobile/*`
- Device activation/session flow wiring stubbed in app state
- Native feature screens are placeholders pending incremental parity implementation

## Next steps

1. `npm install` (root workspace)
2. `npm --workspace mobile run start`
3. Connect InstantDB client and auth providers in `mobile/src/providers/AppProviders.js`
4. Implement Phase 1 flows (`activate`, `lock`, kid/parent principal switching)

