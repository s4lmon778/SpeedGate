# Maintenance notes

SpeedGate 0.3.37 adds an October 24, 2026 connection-setup fix after the
October 21 pause. The 0.3.36 transfer performance settings are retained.
The app remains experimental; documented browser/device limits still apply.
There is no committed schedule for further work or security fixes.

## Repository layout

- `main` contains source, tests, documentation, synthetic benchmark records,
  and README media. Generated builds and browser profiles do not belong here.
- `gh-pages` contains the published app and intentional historical releases.
  Older hashed assets support open tabs and worker loading; retain them when
  publishing. The 0.3.28 comparison build is explicitly linked from the README.
- SpeedGate is the current project, package, and checkout name. Legacy
  `pixelgate`/`pixelbridge` storage and protocol identifiers and `PIXELGATE_*`
  environment aliases preserve stored data and older-peer compatibility.
  Historical measurement names retain their original provenance.
- The optional `PixelGate` local symlink supports existing tool references;
  it points to the canonical checkout and stores no duplicate project files.

## Resume development

Use Node.js 22.13+ and run `npm ci`, `npm run check`, `npm run format:check`,
and `npm run build`. Install Playwright browsers as described in the
[development guide](DEVELOPMENT.md), then run the relevant browser checks.
See [deployment](DEPLOYMENT.md) before publishing; pushing source alone does
not update the live app.

Run `npm run clean` after validation to remove generated builds, reports,
coverage, and optional local indexes/caches. It preserves source, documentation,
benchmark records, README media, Git history, and installed dependencies.
`node_modules` can also be removed while the project is idle; `npm ci` restores it.

Keep private environment files, registry credentials, keys, personal paths,
real transfer files, live pairing descriptions, and browser profiles out of Git.
Use a GitHub noreply address for both source and deployment commits.
