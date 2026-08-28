export const deploymentStages = ["production", "dev"] as const;
export const deploymentStageTagKey = "cpi:deployment-stage";

export type DeploymentStage = (typeof deploymentStages)[number];

export function resolveDeploymentStage(value: unknown): DeploymentStage {
  if (value === undefined) {
    return "production";
  }

  if (value === "production" || value === "dev") {
    return value;
  }

  throw new Error("targetStage must be production or dev");
}

export function stageResourceName(
  stage: DeploymentStage,
  resourceName: string,
): string {
  return stage === "production"
    ? `cpi-${resourceName}`
    : `cpi-${stage}-${resourceName}`;
}
