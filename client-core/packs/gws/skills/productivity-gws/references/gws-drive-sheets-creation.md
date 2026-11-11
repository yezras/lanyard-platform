# gws Drive + Sheets Creation Patterns (2026-06-29 session)

## Folder creation
gws drive files create --json '{"name": "Folder Name", "mimeType": "application/vnd.google-apps.folder"}' --format json

## Spreadsheet creation (root first)
gws sheets spreadsheets create --json '{"properties": {"title": "Sheet Title"}}' --format json
→ returns spreadsheetId + spreadsheetUrl

## Move into folder (add parent)
gws drive files update --params '{"fileId": "<spreadsheetId>", "addParents": "<folderId>"}' --format json

## Add multiple tabs (batchUpdate)
gws sheets spreadsheets batchUpdate --params '{"spreadsheetId": "<id>"}' --json '{"requests": [{"addSheet": {"properties": {"title": "TabName"}}}, ...]}'

## Populate values (handles spaces in title via escaped quoting)
gws sheets spreadsheets values update --params '{"spreadsheetId": "<id>", "range": "'\''Tab Name'\''!A1", "valueInputOption": "RAW"}' --json '{"values": [[...]]}'

## Notes
- spreadsheets create does not accept "parents" in the request body (validation error).
- Use sheetId (numeric) or carefully escaped title in range strings when titles contain spaces.
- All operations return the updated resource on success; capture IDs immediately.