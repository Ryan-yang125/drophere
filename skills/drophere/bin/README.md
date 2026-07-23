# Bundled DropHere CLI

`drophere.js` is generated from `packages/cli/src` in the same public Git commit.
It lets the Skill run the official CLI without downloading or executing an
installer at runtime.

Maintainers rebuild it with:

```bash
pnpm skill:bundle-cli
```

`drophere.js.sha256` records the generated file's SHA-256 digest. The public
release check compares the bundled file byte-for-byte with a fresh CLI build
and verifies the digest before publication.
