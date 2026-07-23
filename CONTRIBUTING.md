# Contributing to DropHere

Thanks for helping make agent-driven static deployment safer and simpler.

## Good first contributions

- Add build-output detection for another static-site framework.
- Improve secret-file detection with a focused regression test.
- Add a deployment verification check for a common static-site failure.
- Clarify a Skill instruction after reproducing the confusing behavior.
- Report a small, repeatable deployment compatibility issue.

## Development setup

```bash
pnpm install
pnpm check
```

The public repository contains the DropHere Skill, CLI, browser-safe deploy core,
and a small example site. The hosted API is operated separately at
`https://drophere.page`.

## Pull requests

1. Keep each change focused on one behavior.
2. Add or update tests for code changes.
3. Run the narrow package tests while iterating and `pnpm check` before opening
   the pull request.
4. Explain the user-facing behavior, verification performed, and any remaining
   tradeoffs.
5. Keep credentials, private deployment URLs, and customer content out of
   commits and issue screenshots.

By contributing, you agree that your contributions are licensed under the MIT
License.
