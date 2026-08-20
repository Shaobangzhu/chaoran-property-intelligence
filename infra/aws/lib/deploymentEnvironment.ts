import type { Environment } from "aws-cdk-lib";

export const defaultAwsRegion = "us-west-2";

export function resolveDeploymentEnvironment(
  environment: NodeJS.ProcessEnv,
): Environment {
  const account = environment.CDK_DEFAULT_ACCOUNT?.trim();
  const region = environment.CPI_AWS_REGION?.trim() || defaultAwsRegion;

  return account === undefined || account.length === 0
    ? { region }
    : { account, region };
}
