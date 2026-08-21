import passwordPrompt from "@inquirer/password";

import { createAdmin } from "./createAdmin.js";
import { runCreateAdminCli } from "./runCreateAdminCli.js";

process.exitCode = await runCreateAdminCli(
  {
    args: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  },
  {
    promptPassword: (options) => passwordPrompt(options),
    createAdmin: (input) =>
      createAdmin({
        environment: process.env,
        input,
      }),
  },
);
