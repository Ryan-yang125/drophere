# DropHere

[![skills.sh installs](https://skills.sh/b/Ryan-yang125/drophere)](https://skills.sh/Ryan-yang125/drophere/drophere)

DropHere is a free Agent Skill and CLI for publishing a static site from a
coding-agent session. It detects likely build output, checks the public upload
for common secrets, deploys it to `drophere.page`, and verifies the resulting
URL.

The product name stays **DropHere**. The command is `drophere` and the official
hosted service is [drophere.page](https://drophere.page).

## Fastest path: Agent Skill

Install the Skill:

```bash
npx skills add Ryan-yang125/drophere --skill drophere
```

Then ask your coding agent:

```text
Use the drophere skill to publish this static project and verify the live URL.
```

The Skill carries a checksum-verified CLI bundle built from the public source in
this repository. It detects the build output, scans it, creates a guest deploy,
and verifies the returned URL without downloading an executable at runtime.

Guest sites expire after three days. You can create an account later and claim
a site from the same machine with the bundled CLI.

## Standalone CLI

Download `drophere.js` and `drophere.js.sha256` from the
[latest release](https://github.com/Ryan-yang125/drophere/releases/latest), then
verify the downloaded file before running it:

```bash
shasum -a 256 -c drophere.js.sha256
node ./drophere.js guest ./dist
```

Linux users can run `sha256sum -c drophere.js.sha256`. The command returns a
temporary public `*.drophere.page` URL. The interactive password prompt is
masked. For agent automation, pipe the password through standard input and add
`--password-stdin`; keep the value out of command arguments and logs.

For a manual installation, copy `skills/drophere` into your agent's Skill
directory, such as `~/.agents/skills/drophere`.

The Skill defaults to a guest deployment. It asks for account credentials only
when you explicitly request a permanent, named project.

## Safety boundary

Every deployed file becomes public. Point DropHere at generated output such as
`dist`, `build`, or `out`. The Skill runs a preflight scan, and the CLI refuses
common credential filenames including `.env.*`, private keys, and cloud
credential directories. Review the file list whenever the project contains
private data or unusual generated assets.

## Repository layout

```text
skills/drophere/       Agent Skill, bundled CLI, scripts, references, and evals
packages/cli/          drophere command-line client
packages/deploy-core/  browser-safe deployment primitives
examples/hello-site/   tiny static deployment fixture
```

The hosted service implementation and production infrastructure are maintained
separately. See [SOURCE_BOUNDARY.md](SOURCE_BOUNDARY.md).

## Develop

```bash
pnpm install
pnpm check
```

## Free service and fair use

DropHere has no paid plan. The hosted service uses published quotas to keep the
shared free infrastructure reliable. Guest projects are temporary, and account
projects receive larger limits after email verification. Current limits are
shown by:

```bash
drophere quota
drophere usage
```

## Contributing

Small compatibility fixes, clearer checks, and reproducible deployment cases
are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[security policy](SECURITY.md) before opening a pull request or report.

MIT licensed.
