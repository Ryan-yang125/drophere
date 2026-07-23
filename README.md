# DropHere

DropHere is a free Agent Skill and CLI for publishing a static site from a
coding-agent session. It detects likely build output, checks the public upload
for common secrets, deploys it to `drophere.page`, and verifies the resulting
URL.

The product name stays **DropHere**. The command is `drophere` and the official
hosted service is [drophere.page](https://drophere.page).

## Fastest path: guest deploy

Install the CLI:

```bash
curl -fsSL https://drophere.page/install.sh | bash
```

Publish a generated static directory:

```bash
drophere guest ./dist
```

The command returns a public `https://drop-xxxxxxxx.drophere.page/` URL. Guest
sites expire after three days. You can create an account later and claim a site
from the same machine:

```bash
drophere login --email you@example.com
drophere claim drop-xxxxxxxx.drophere.page
```

The interactive password prompt is masked. For agent automation, pipe the
password through standard input and add `--password-stdin`; keep the value out
of command arguments and logs.

## Install the Agent Skill

With the Skills CLI:

```bash
npx skills add Ryan-yang125/drophere --skill drophere
```

For a manual installation, copy `skills/drophere` into your agent's Skill
directory, such as `~/.agents/skills/drophere`.

Then ask your coding agent:

```text
Use the drophere skill to publish this static project and verify the live URL.
```

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
skills/drophere/       Agent Skill, scripts, references, and evals
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
