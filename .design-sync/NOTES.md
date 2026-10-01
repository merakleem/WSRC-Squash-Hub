# Design sync notes (PlayWSRC → Claude Design)

## How this repo syncs

- The app is plain JS (template strings + `renderer/styles.css`), not React. The sync target is
  `design-system/` (`playwsrc-ui`): React components that emit the app's exact markup and class
  names. The app does not use this package; it exists only for Claude Design.
- `design-system/build.mjs` copies `renderer/styles.css` verbatim into `dist/playwsrc.css` and
  appends `src/canvas.css` (releases the app's `body { height: 100dvh; overflow: hidden }`, which
  would otherwise stop designs from scrolling). Rebuild with `cfg.buildCmd` whenever
  `renderer/styles.css` or `design-system/src` changes, then re-run the driver.
- Converter run: `--node-modules ./design-system/node_modules --entry ./design-system/dist/index.js`.
- Fonts: the app loads Inter/Barlow from Google Fonts in `renderer/index.html`; the converter only
  scrapes remote font imports from Storybook, so the latin woff2 files are self-hosted in
  `design-system/fonts/` (SIL OFL) and wired via `cfg.extraFonts`.
- The sidebar crest is a 5 KB downscale (`design-system/src/crest.png`) of
  `public/assets/WSRC_Logo_Grey 3.png` (1.1 MB), inlined as a data URL by esbuild.
- Grouping is by `cfg.docsMap` regroup stubs in `design-system/docs/groups/*.md`.

## Gotchas

- `[DTS_STYLE_SYSTEM]` filters every inherited React HTML prop (disabled, onClick, value,
  placeholder...). Props the design agent needs are declared explicitly in each component's
  Props interface; do the same for any new component.
- The prop-doc extractor keeps only the first line of a multi-line JSDoc: keep prop docs on one line.
- Playwright: the repo pins playwright 1.63 (chromium-1243) but this machine's cache had
  chromium-1234, so `.ds-sync` uses playwright@1.62.1. Re-check `%LOCALAPPDATA%/ms-playwright`.
- Heredocs with nested quotes broke the Git Bash tool; write preview files with the file tool.

## Known render warns

- Undefined-token count (1 missing, below threshold): `--avatar-bg`, `--pill-color`, `--court-w`,
  `--hover`, `--input-border` are set inline per element by the app or have fallbacks. Benign.
- App quirks reproduced faithfully (not sync bugs): `.form-control` textareas and date inputs
  render in the browser's monospace font, and `.tr-tab` / `<select>` use the system font, because
  the app never sets `font-family: inherit` on those controls. Fix in `renderer/styles.css` if
  wanted; the sync picks it up on rebuild.
- `Input` Disabled looks the same as enabled: `.form-control` has no disabled style in the app.

## Re-sync risks

- `dist/playwsrc.css` is a copy of `renderer/styles.css` made at build time: an app CSS change is
  invisible to Claude Design until `buildCmd` + driver + upload run again.
- The components are a hand-kept mirror of markup in `renderer/pages/*.js`, `renderer/matchCard.js`
  and `renderer/index.html`. If those templates change class names or structure, update the
  matching `design-system/src/*.tsx`; nothing checks this automatically.
- `Bracket` spreads rounds with flex space-around; the app's fixed 8-player bracket uses spacer
  divs. Close, not pixel-identical.
- Previews were graded on this machine's Chromium 1234 only.
