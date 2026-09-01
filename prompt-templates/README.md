# Prompt templates

`GET /api/prompt-templates` reads `prompt-templates/{image,video}/*.json` on
every call. Each file is one media prompt preset (see
`apps/daemon/src/media/prompt-templates.ts` for the validated shape).

This fork ships no bundled presets. The upstream set pointed its
`previewImageUrl` / `previewVideoUrl` at third-party CDNs
(`cms-assets.youmind.com`, `cloudflarestream.com`, `static.heygen.ai`,
`pbs.twimg.com`) that staff browsers would fetch on every gallery render, and
the imagery was off-brand for the chamber.

The loader and the New-project panel both handle an empty catalog: the daemon
returns `{ promptTemplates: [] }` and the panel renders its empty state. Drop a
new `<id>.json` into `image/` or `video/` to add one back; `id` must equal the
file name and `surface` must match the folder.
