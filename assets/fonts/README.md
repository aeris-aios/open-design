# Bundled fonts

Poppins, subset to the glyphs the chamber's material uses (Latin, Latin
Extended, punctuation, currency and common symbols) at the four weights the
brand calls for: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold.

These are embedded as base64 `@font-face` rules by
`apps/daemon/src/headless-artifact-export.ts` when it renders an artifact, so
exports carry the brand typeface with no network fetch and no CORS dependency.
A container has no system Poppins, so without these every exported PDF and PNG
silently fell back to Noto Sans, and files left the studio off-brand.

Licensed under the SIL Open Font License 1.1 (see `OFL.txt`), which permits
redistribution including in bundled and subset form. The copyright and license
are also preserved inside each file's own name table.

Upstream: https://github.com/itfoundry/Poppins
