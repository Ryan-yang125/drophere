# Static output reference

Use this reference after identifying the project framework. Deploy a directory containing browser-ready files and a top-level `index.html`.

## Framework outputs

| Signal | Build command | Expected output | Required check |
| --- | --- | --- | --- |
| Plain HTML | none | directory containing `index.html` | Scan the whole directory; allow only intentional public files |
| Vite with React, Vue, Svelte, or vanilla JS | package-manager `build` script | `dist/` | Ensure `dist/index.html` exists |
| Create React App | package-manager `build` script | `build/` | Ensure `build/index.html` exists |
| Astro | package-manager `build` script | `dist/` | Use static output; exclude server adapters |
| Next.js | package-manager `build` script with `output: "export"` | `out/` | Upload `out/`; reject `.next/` |
| Nuxt | `generate` script or documented static build | `.output/public/` or `dist/` | Upload the generated public directory; reject the server directory |
| SvelteKit | package-manager `build` script with `adapter-static` | commonly `build/` | Confirm the adapter and generated `index.html` |
| Gatsby | package-manager `build` script | `public/` | Confirm `public/index.html` |
| Docusaurus | package-manager `build` script | `build/` | Confirm `build/index.html` |
| Eleventy | package-manager build script | `_site/` | Confirm `_site/index.html` |
| Hugo | `hugo` | `public/` | Confirm `public/index.html` |
| Jekyll | `bundle exec jekyll build` | `_site/` | Confirm `_site/index.html` |
| MkDocs | `mkdocs build` | `site/` | Confirm `site/index.html` |

Read the repository's own build script as the source of truth. Pass `--output <relative-directory>` to `detect-build-output.mjs` when a project intentionally uses a custom output path.

## Package-manager selection

Prefer the lockfile already present in the selected package:

| Lockfile | Build command shape |
| --- | --- |
| `pnpm-lock.yaml` | `pnpm build` |
| `yarn.lock` | `yarn build` |
| `bun.lock` or `bun.lockb` | `bun run build` |
| `package-lock.json` | `npm run build` |

Inspect `package.json#scripts.build` before running it. Preserve the existing package manager and lockfile.

## Output selection rules

1. Choose the framework's generated directory over a similarly named source directory.
2. Require a top-level `index.html`, unless the CLI is intentionally given another entrypoint.
3. Resolve the output to an absolute path beneath the selected project directory.
4. Run a fresh build when source files or framework config changed after the last build.
5. Run the sensitive-file scanner after the final build and immediately before upload.
6. Keep source maps under explicit review because they can disclose original source and inline source content.

## Public-upload boundary

Every deployed file is readable through the generated public URL. Include only browser assets such as HTML, CSS, JavaScript, fonts, images, and intentionally public downloads.

Exclude environment files, keys, tokens, account data, databases, logs, source repositories, backend code, server bundles, internal documents, and private downloads. Browser-prefixed environment values such as `VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`, and `NUXT_PUBLIC_*` are embedded into client assets; verify each value is safe for unrestricted public access.

The CLI ignores `.git`, `node_modules`, `.DS_Store`, and `.drophere.local.json`. Continue using a clean generated directory so the upload boundary remains easy to inspect and reproduce.
