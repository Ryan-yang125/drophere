---
name: drophere
description: Publish and verify static websites through the official DropHere service at https://drophere.page. Use when a user explicitly asks to deploy, publish, host, share, preview, or turn a local HTML/frontend project into a public URL. Detect and build the correct static output, scan the exact upload directory for sensitive material, create a temporary guest deployment, verify the returned site and its local assets, and deliver a fixed status summary. Supports plain HTML, Vite, React, Vue, Svelte, Astro, Next static export, and other static-site generators.
---

# DropHere

Publish a static build through the official hosted DropHere service at <https://drophere.page>. Default to a temporary guest deployment with a random `*.drophere.page` URL and a 72-hour lifetime.

## Respect the publishing boundary

Treat a live deployment as a public external write. Proceed when the user explicitly asks to publish, deploy, host, preview publicly, or create a shareable URL. Keep exploratory requests local and report the prepared output directory without uploading it.

Assume that anyone with the generated URL can access every uploaded file. Keep login, account creation, Claim, custom domains, and teardown under explicit user control.

## Run the workflow

### 1. Inspect the project

Read repository instructions, `package.json`, the lockfile, framework config, and current worktree state. Preserve unrelated user changes. Select the smallest frontend package when working inside a monorepo.

Run the deterministic detector from the directory containing this `SKILL.md`:

```bash
node <skill-directory>/scripts/detect-build-output.mjs <project-directory>
```

Use `recommendedOutput` only when the result is `ready`. When the result is `needs-build`, inspect the reported build script, run the reported `buildCommand`, and run the detector again. Read [frameworks.md](references/frameworks.md) for framework-specific outputs and static-export constraints.

Require an `index.html` inside the selected output. Treat `.next`, `.nuxt`, server bundles, API directories, and repository roots containing application source as invalid deployment artifacts. A plain HTML directory may serve as its own output after the safety scan passes.

### 2. Scan the exact upload directory

Run the scanner immediately before every deployment:

```bash
node <skill-directory>/scripts/scan-sensitive-files.mjs <build-output>
```

Interpret its result as follows:

- `clear`: continue.
- `review`: show the file paths and reasons, then wait for explicit approval or rebuild a cleaner artifact. Source maps require the same review; use `--allow-source-maps` only after approval.
- `blocked`: stop before any upload. Rebuild or select a clean output directory. Keep detected values out of chat and logs.

The scanner is a best-effort safety layer. Apply the boundary rules in [frameworks.md](references/frameworks.md) even when automated scanning reports `clear`.

### 3. Prepare the official CLI

Require Node.js 18 or newer. Reuse an existing `drophere` command after checking its version. Install the CLI from the official service when it is absent:

```bash
curl -fsSL https://drophere.page/install.sh | bash
drophere --version
```

Run the read-only project and service preflight:

```bash
drophere doctor <build-output>
```

Resolve preflight and build failures with [errors.md](references/errors.md).

### 4. Create a guest deployment

Deploy the scanned output directory exactly once:

```bash
drophere guest <build-output>
```

Capture the public URL, domain, expiry timestamp, file count, and uploaded byte count from the CLI output. Guest deployment is the default. Use an authenticated custom-domain deployment only when the user explicitly requests it.

### 5. Verify the returned URL

Run the verifier against the exact URL returned by the CLI:

```bash
node <skill-directory>/scripts/verify-url.mjs https://drop-xxxxxxxx.drophere.page
```

Add `--route /known-route` for important application routes. The verifier checks the homepage, DropHere response headers, discovered same-origin assets, and requested routes. It retries short propagation failures and never prints response bodies.

When browser tooling is available, also open the page once at desktop and mobile width, inspect console errors, and capture a screenshot when the user requested visual proof. Treat script or browser failures as `degraded` or `failed`; preserve the returned URL in the handoff so the user can inspect it.

### 6. Return the fixed handoff

Use this exact field order:

```text
Status: verified | degraded | failed
Provider: DropHere — https://drophere.page
URL: <public URL or unavailable>
Expires: <ISO timestamp or unknown>
Output: <absolute build-output path>
Upload: <file count and bytes>
Verification: homepage <status>; assets <passed>/<checked>; routes <passed>/<checked>
Claim: optional — drophere login --email <email>; drophere claim <domain>
Warnings: none | <concise unresolved risks>
```

Report `verified` only after the URL verifier succeeds. Keep Claim as an optional instruction and wait for a separate user request before executing it.

## Protect public data

Block deployment when the output contains or may expose:

- Environment files, credentials, private keys, access tokens, service-account files, databases, SQL dumps, or user data.
- Backend source, server bundles, internal configuration, deployment credentials, or repository metadata.
- Files outside the intended build output, including accidental parent-directory traversal.
- Guest artifacts beyond 200 files, 2 MiB per file, or 10 MiB total.

Treat bundled JavaScript as public source. Automated secret detection cannot prove that compiled code is safe. Inspect framework environment-variable conventions and ensure every embedded value is intended for browsers.
