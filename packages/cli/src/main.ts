import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANAGEMENT_COMMANDS, VERSION } from "./constants";
import { printHelp } from "./help";
import { claim, contact, doctor, files, guest, list, login, logout, printToken, publish, quota, rename, teardown, usage, verifyEmail, whoami } from "./commands";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const first = argv[0];

  if (first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return;
  }

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (first === "publish") {
    await publish(argv.slice(1));
    return;
  }

  if (first && MANAGEMENT_COMMANDS.has(first)) {
    await runManagementCommand(first, argv.slice(1));
    return;
  }

  await publish(argv);
}

async function runManagementCommand(command: string, args: string[]): Promise<void> {
  if (command === "login") await login(args);
  else if (command === "guest") await guest(args);
  else if (command === "claim") await claim(args);
  else if (command === "verify-email") await verifyEmail(args);
  else if (command === "logout") await logout();
  else if (command === "whoami") await whoami(args);
  else if (command === "doctor") await doctor(args);
  else if (command === "token") await printToken(args);
  else if (command === "quota") await quota(args);
  else if (command === "usage") await usage(args);
  else if (command === "contact") await contact(args);
  else if (command === "list") await list(args);
  else if (command === "files") await files(args);
  else if (command === "rename") await rename(args);
  else if (command === "teardown") await teardown(args);
}

if (isEntrypoint()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]));
}
