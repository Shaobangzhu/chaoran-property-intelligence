import { spawnSync } from "node:child_process";

interface WorkflowRunScript {
  name: string;
  script: string;
}

export function validateMultilineWorkflowShell(workflow: string): number {
  const scripts = extractMultilineRunScripts(workflow);

  for (const { name, script } of scripts) {
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: script,
    });
    if (result.status !== 0 || result.stderr !== "") {
      throw new Error(
        `${name} contains invalid Bash:\n${result.stderr || "bash -n failed"}`,
      );
    }
  }

  return scripts.length;
}

function extractMultilineRunScripts(workflow: string): WorkflowRunScript[] {
  const lines = workflow.split("\n");
  const scripts: WorkflowRunScript[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = /^(\s*)run:\s*([|>])-\s*$/u.exec(lines[index] ?? "");
    if (!runMatch) {
      continue;
    }

    const runLineIndex = index;
    const runIndent = runMatch[1]?.length ?? 0;
    const scriptIndent = runIndent + 2;
    const scalarStyle = runMatch[2];
    const scriptLines: string[] = [];

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (line.length > 0 && indentation <= runIndent) {
        index -= 1;
        break;
      }
      scriptLines.push(line.slice(Math.min(scriptIndent, line.length)));
    }

    const name = lines
      .slice(0, runLineIndex)
      .reverse()
      .find((line) => /^\s*- name:\s+/u.test(line))
      ?.replace(/^\s*- name:\s+/u, "") ?? "unnamed run step";
    scripts.push({
      name,
      script:
        scalarStyle === "|" ? scriptLines.join("\n") : scriptLines.join(" "),
    });
  }

  return scripts;
}
