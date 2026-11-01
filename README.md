# FIT truncate

A small Svelte + Vite page for removing ranges of `device_info` messages from FIT files. All file processing happens in the browser; there is no backend, upload, analytics, or remote font dependency.

## Project principles

- **Keep it a minimal MVP.** Prefer the simplest change that works: few dependencies, no frameworks or tooling beyond Svelte + Vite, and no features beyond removing `device_info` ranges.
- **Process files entirely client-side.** FIT files are read, edited, and downloaded in the browser. Never add a backend, upload, analytics, or third-party requests.

## Run locally

Use Node.js 24 LTS.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run format       # Prettier; CI runs `npm run format:check`
npm run build
npm run preview
```

## Use

1. Open a `.fit` file. Basic information and a device information table appear.
2. Inspect the first/last pages or jump directly to an entry. Only 50 rows are rendered at once, even for files with tens of thousands of entries. All available device fields are shown; scroll sideways to see more.
3. Enter an inclusive range of **device entry numbers**, then select **Add removal range**. For example, `5` through `25998` preserves the first four and all entries after 25998. This removes every device entry in that interval, regardless of timestamp or device identity.
4. Add more ranges if needed. Overlaps are counted once. Original numbering stays fixed. Marked rows show what will be removed; **Discard** or **Clear ranges** restores them.
5. Download a new `-trimmed.fit` file. The source file remains untouched.

## GitHub Pages

Before the first deploy, enable Pages under **Settings → Pages → Build and deployment → Source: GitHub Actions**. Otherwise the workflow fails with `HttpError: Not Found` because the Pages site doesn't exist yet. After that, the included workflow runs tests, builds, and deploys on pushes to `main` (or via its manual Run workflow button).

Vite uses relative asset paths, so the same build works at a repository subpath. `dist/` can also be served by any static host.

## Implementation and limits

`src/App.svelte` contains the interface; `src/fit.js` handles reading and removal. Garmin's [official JavaScript SDK](https://github.com/garmin/fit-javascript-sdk) decodes values and verifies file integrity. Decoder callbacks identify the byte boundaries of each device message. Export copies the original bytes, excluding only the selected device messages, then updates the data length and header/file checksums. The decoder's `includeUnknownData` option is required for this: without it, unknown messages would not trigger callbacks and could be removed along with a neighbouring device message. Definitions, unknown messages, developer fields, activity records, and remaining device messages retain their original bytes.

The tool accepts a single valid FIT file with a standard 12- or 14-byte header. Corrupt, chained, and compressed-timestamp files are rejected rather than edited. The Garmin JavaScript reader currently does not support compressed timestamp messages. Files are held in memory; pagination limits rendered rows, not file size. No automatic deduplication or activity time trimming is performed.

Tests generate synthetic FIT data, including 26,000 alternating device entries. Personal FIT files are ignored by Git and are not included in the project.

## License

[MIT](LICENSE)
