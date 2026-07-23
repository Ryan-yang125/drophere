# Error recovery

Use the narrowest recovery matching the observed evidence. Rerun detection and scanning after every rebuild.

## Build output is missing

- Inspect `package.json#scripts`, the lockfile, and framework config.
- Run the repository's declared build command with its existing package manager.
- For a custom directory, pass `--output <path>` to `detect-build-output.mjs`.
- Require `index.html` before continuing.

## A server build was produced

- For Next.js, configure static export and use `out/`.
- For Nuxt, generate a public static output and use `.output/public/` or the configured static directory.
- For SvelteKit, confirm `adapter-static` and its output path.
- Stop when the project requires server functions, databases, API routes, middleware, or runtime secrets. DropHere serves static artifacts.

## The safety scan reports `blocked`

- Read only the reported path and rule; keep file contents out of terminal output and chat.
- Remove the sensitive input from the build process or rebuild into a clean directory.
- Rotate a credential if evidence shows it was previously published.
- Run the scanner again and require `clear` before the first upload.

## The safety scan reports `review`

- Explain each path-level risk to the user.
- Rebuild without source maps, source files, backup files, or internal manifests when practical.
- Proceed with reviewed artifacts only after explicit approval and list the accepted warnings in the handoff.

## Guest quota or rate limit is reached

- Preserve the exact friendly CLI error and remaining-quota information.
- Avoid repeated deploy attempts during the same rate-limit window.
- Offer a later retry. Use the contact shown by `drophere contact` when service help is needed.
- Keep account login and authenticated deployment as user-directed options.

## Cloudflare or TLS connectivity is intermittent

- Retry public endpoint checks with short delays.
- Run `curl -4 --http1.1 -fsS --retry 5 --retry-delay 2 <url>` when local TLS negotiation remains unstable.
- Treat a successful CLI deployment plus a temporary local curl failure as a verification retry case.
- Leave VPN and proxy settings unchanged unless the user requests a network change.

## Homepage verification fails

- Retry with `verify-url.mjs`; its default retry window covers short propagation delays.
- Confirm the URL came directly from `drophere guest` and ends in `.drophere.page`.
- Check for an expired guest deployment (`410`) or an incorrect entrypoint.
- Report `failed` while the homepage remains unavailable.

## Assets return 404

- Inspect generated asset URLs in `index.html`.
- Fix the framework base/public path, rebuild, rescan, and create a fresh guest deployment after user authorization.
- Report the failed asset count and paths. Keep response bodies and query secrets out of the handoff.

## The page is blank or crashes in the browser

- Inspect browser console errors and failed network requests.
- Confirm runtime configuration intended for browsers was embedded during the build.
- Verify an important SPA route with `verify-url.mjs --route /route`.
- Report `degraded` when HTTP checks pass and browser execution still fails.

## A guest site expires

- Treat `410 Gone` with `x-drophere-expired: true` as an expired deployment.
- Create a fresh guest deployment only after a new publish request.
- Present Claim as an optional future action for a live guest site. Execute login or Claim after explicit user direction.
