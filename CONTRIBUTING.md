# Contributing to Link Scrubber

Thanks for considering a contribution. Bug reports, docs fixes, and small
improvements are all welcome.

## Dev setup

```bash
git clone https://github.com/Avicennasis/link-scrubber.git
cd link-scrubber
npm install
npm run dev            # Chrome dev server with hot reload
npm run dev:firefox    # Firefox dev server with hot reload
```

## Running the tests

```bash
npm test               # Runs the vitest unit suite once
npm run test:watch     # Watch mode for iterative development
```

CI runs `npm test` plus `npm run build` for both Chromium and Firefox
targets. Make sure those pass locally before opening a PR.

## Project conventions

### Comments are for non-developers

Code comments are written in plain English so non-technical users can audit
what the extension does. This is a core promise of the **Privacy &
Transparency** section in the README. Explain the *why*, not just the
*what*. Any new function that touches storage or could be confused for
networking should carry a brief "data never leaves your browser" note.

### Banner-block comment style

Each source file opens with a `// -----`-bordered block that names the
file's role in plain English, explains how it works in numbered steps, and
includes a Privacy Notice. New files should follow that pattern.

### One source of truth for URL rewriting

Both `entrypoints/content.ts` (DOM `<a href>` rewrites) and
`entrypoints/main-world.ts` (programmatic navigation interception)
**must** use `rewriteUrl` from `utils/rewriter.ts`. Do not reimplement
URL-rewriting logic anywhere else — divergence between the two paths is
a real correctness bug, not just a code-smell.

### Build is auditable, not minified

`wxt.config.ts` sets `minify: false` and `sourcemap: true` for production
builds. **Do not change this.** A privacy tool whose build output users
can't read defeats its own purpose.

### No external URLs in source

The CI workflow scans `entrypoints/` and `utils/` for `http(s)://` URLs
outside of comments. If a future change adds a remote-resource URL, the
PR will be blocked. All resources must be bundled locally.

## PR checklist

- [ ] `npm test` is green locally.
- [ ] `npm run build && npm run build:firefox` both succeed.
- [ ] No new external URLs in `entrypoints/` or `utils/` (privacy/security check).
- [ ] CSP unchanged or tightened — never add `'unsafe-inline'`.
- [ ] README and docs updated if public behavior changed.
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
Be respectful; assume good faith.
