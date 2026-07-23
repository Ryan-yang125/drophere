import { CliError } from "./errors";

export type CommonOptions = {
  api?: string;
  email?: string;
  password?: string;
  passwordStdin?: boolean;
  project?: string;
  domain?: string;
  token?: string;
  positionals: string[];
};

export type PublishOptions = CommonOptions & {
  entrypoint: "index.html";
};

export function parsePublishArgs(args: string[]): PublishOptions {
  const common = parseCommonArgs(args);
  const positionals = [...common.positionals];
  return {
    ...common,
    project: common.project ?? positionals.shift(),
    domain: common.domain ?? positionals.shift(),
    entrypoint: "index.html"
  };
}

export function parseCommonArgs(args: string[]): CommonOptions {
  const options: CommonOptions = {
    api: undefined,
    email: undefined,
    password: undefined,
    passwordStdin: false,
    project: undefined,
    domain: undefined,
    token: undefined,
    positionals: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--endpoint" || arg === "-e") {
      options.api = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--email") {
      options.email = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--password") {
      options.password = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--password-stdin") {
      options.passwordStdin = true;
    } else if (arg === "--token") {
      options.token = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--project" || arg === "-p") {
      options.project = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--domain" || arg === "-d") {
      options.domain = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--preview") {
      if (args[index + 1] && !args[index + 1]!.startsWith("-")) index += 1;
    } else if (arg === "-s" || arg === "--stage" || arg === "-m" || arg === "--message" || arg === "-a" || arg === "--add" || arg === "-r" || arg === "--remove") {
      if (args[index + 1] && !args[index + 1]!.startsWith("-")) index += 1;
    } else if (arg.startsWith("--")) {
      throw new CliError(`Unknown option: ${arg}`);
    } else {
      options.positionals.push(arg);
    }
  }

  return options;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new CliError(`${option} requires a value`);
  }
  return value;
}
