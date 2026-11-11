# gws Drive download patterns (2026-06-02 session)

## Working binary/image download
Use `gws drive files get` (not the `download` subcommand) with `alt=media`:

```
gws drive files get --params '{"fileId": "<ID>", "alt": "media"}' -o /local/path.ext
```

Returns JSON with bytes, mimeType, saved_file, status=success.

The dedicated `download` subcommand expects different invocation (fileId via params or different prefix) and produced validation/backend errors in testing.

## Search patterns used for Lanyard assets
- `mimeType contains "image/" and name contains "lanyard"` (returned 11 logo/icon/lockup files)
- `sharedWithMe=true and mimeType contains "image/"` returned empty (assets lived in My Drive)

All assets successfully transferred to `Lanyard/dev/design/`.