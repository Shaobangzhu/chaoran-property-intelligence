export interface ApplicationSecret {
  RENTCAST_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export function createApplicationSecret(
  environment: NodeJS.ProcessEnv,
): ApplicationSecret {
  return {
    RENTCAST_API_KEY: readRequired(environment, "RENTCAST_API_KEY"),
    TELEGRAM_BOT_TOKEN: readRequired(environment, "TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: readRequired(environment, "TELEGRAM_CHAT_ID"),
  };
}

function readRequired(
  environment: NodeJS.ProcessEnv,
  variableName: keyof ApplicationSecret,
): string {
  const value = environment[variableName]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${variableName} is required`);
  }

  return value;
}
