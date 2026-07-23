import { VERSION } from "./constants";

export function printHelp(): void {
  process.stdout.write(`
DropHere ${VERSION}

Agent quick path:
  drophere guest <path>
      Deploy a folder without login. DropHere assigns a random temporary domain.

  drophere login --email <email>
      Log in or create an account with a masked password prompt.

  drophere claim <domain>
      Keep the last guest deployment after login. Requires this machine's guest token.

Authenticated deploy:
  drophere <path> <domain>
      Deploy a folder to a chosen drophere.page subdomain.

Project commands:
  drophere list
      List projects for the current user or guest session.

  drophere list <domain>
      List retained deployments for one project.

  drophere files <domain>
      List files in the latest deployment.

  drophere rename <current-domain> <new-domain>
      Rename a claimed or account-owned project to another drophere.page subdomain.

  drophere teardown <domain>
      Remove a project and its deployed files.

Account commands:
  drophere whoami
      Show endpoint, token mode, account or guest status, and API health.

  drophere doctor [path]
      Check API health, local auth, and whether a folder is ready to deploy.

  drophere quota [domain]
      Show remaining quota only.

  drophere usage
      Show account status, verification status, and remaining quota.

  drophere verify-email
      Send a verification email for the current account.

  drophere contact
      Show DropHere contact info.

  drophere logout
      Revoke the user token and keep guest claim data.

  drophere token
      Print the current user token for automation.

Options:
  --endpoint <url>    Override API endpoint. Default: https://api.drophere.page
  --token <token>     Use a bearer token for this command.
  --password-stdin    Read the login password from standard input.
  --version           Print version.
  --help              Print this help.

Guest rules:
  Guest deploys expire automatically and cannot choose a domain.
  To choose a domain, run login first and use: drophere <path> <domain>
`);
}
