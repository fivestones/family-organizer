# iPhone Shortcuts: Add Chore for Today

This repo now exposes a narrow mobile-shortcut API for a two-shortcut flow:

- `Setup / Refresh Family Organizer Shortcut`
- `Add Chore for Today Shortcut`

The setup shortcut is responsible for initial credentialed setup and all future assignee-roster refreshes.
The add-chore shortcut never refreshes family members on its own. It uses the cached list saved by setup.

## Saved Config

Store the setup output in:

- `Shortcuts/Family Organizer/AddTodayChore.json`

Suggested file contents:

```json
{
  "version": 1,
  "serverUrl": "https://example.com",
  "shortcutToken": "fost_...",
  "parentFamilyMemberId": "fm_parent_123",
  "parentName": "David",
  "assignees": [
    { "id": "fm_1", "label": "Judah" },
    { "id": "fm_2", "label": "David (parent)" }
  ],
  "savedAt": "2026-03-22T12:34:56.000Z",
  "lastRefreshedAt": "2026-03-22T12:34:56.000Z"
}
```

Do not persist:

- activation code
- device-session token
- raw parent PIN
- parent Instant token

## Setup / Refresh Shortcut

Recommended logic:

1. Try loading `AddTodayChore.json`.
2. If the file exists and contains `serverUrl` plus `shortcutToken`, call:

   - `GET {serverUrl}/api/mobile/shortcuts/family-members`
   - Header: `X-Family-Shortcut-Token: {shortcutToken}`

3. If that succeeds:

   - rebuild `assignees`
   - overwrite only roster-related fields plus `lastRefreshedAt`
   - save the JSON file again
   - show a success message like `Family members refreshed`

4. If the config file is missing, malformed, or the refresh call returns `401` / `403`, fall back to full setup:

   - ask for `serverUrl`
   - ask for activation code
   - `POST {serverUrl}/api/mobile/device-activate`
   - `GET {serverUrl}/api/mobile/family-members`
   - choose the parent from parent-role rows
   - ask for the parent PIN
   - `POST {serverUrl}/api/mobile/shortcuts/chore-create-token`
   - save the returned shortcut token plus cached assignees

## Add Chore for Today Shortcut

Recommended logic:

1. Load `AddTodayChore.json`.
2. If missing, stop and tell the user to run setup.
3. Ask for chore title.
4. Show `Choose from List` using `assignees[].label`.
5. Resolve the chosen label to `assigneeFamilyMemberId`.
6. Call:

   - `POST {serverUrl}/api/mobile/shortcuts/chore-create`
   - Header: `X-Family-Shortcut-Token: {shortcutToken}`
   - Body: `{ "title": "...", "assigneeFamilyMemberId": "..." }`

7. On success, show the created title, assignee label, and returned `dateKey`.
8. If the API returns `401`, stop and tell the user to rerun setup.

## Assignee Labels

Build cached labels with these rules:

1. Use `name` if it is unique.
2. If names collide, use `name (role)`.
3. If that still collides, use `name (role • last4id)`.

## API Summary

### `POST /api/mobile/shortcuts/chore-create-token`

Request body:

```json
{
  "familyMemberId": "fm_parent_123",
  "pin": "1234",
  "label": "Kitchen Shortcut"
}
```

Auth:

- `Authorization: Bearer {deviceSessionToken}`

Response:

```json
{
  "shortcutToken": "fost_...",
  "parentFamilyMemberId": "fm_parent_123",
  "label": "Kitchen Shortcut"
}
```

### `GET /api/mobile/shortcuts/family-members`

Auth:

- `X-Family-Shortcut-Token: {shortcutToken}`

Response:

```json
{
  "familyMembers": [
    {
      "id": "fm_1",
      "name": "Judah",
      "role": "child",
      "photoUrls": null
    }
  ]
}
```

### `POST /api/mobile/shortcuts/chore-create`

Auth:

- `X-Family-Shortcut-Token: {shortcutToken}`

Request body:

```json
{
  "title": "Clean room",
  "assigneeFamilyMemberId": "fm_1"
}
```

Response:

```json
{
  "choreId": "chore_123",
  "title": "Clean room",
  "assigneeFamilyMemberId": "fm_1",
  "dateKey": "2026-03-22"
}
```
