# Changelog

All notable public changes to the DropHere Skill and CLI are documented here.

## Unreleased

## 1.0.1 - 2026-07-24

- Bundled the reproducible DropHere CLI inside the Skill with SHA-256 integrity
  checks before every CLI action.
- Removed runtime shell installation from the Skill workflow.
- Derived deployment asset checks from the scanned local `index.html` while
  keeping remote response bodies opaque.
- Added tamper rejection, local-versus-remote asset isolation, and a no-global-
  CLI evaluation scenario to the public release checks.

## 1.0.0 - 2026-07-23

- Added the free DropHere Agent Skill with build-output detection, deployment
  preflight checks, guest publishing, and live URL verification.
- Published the DropHere CLI and browser-safe deployment core under the MIT
  License.
- Added guest deployments that expire after three days and can be claimed after
  login.
- Added safeguards for common credential filenames before upload.
