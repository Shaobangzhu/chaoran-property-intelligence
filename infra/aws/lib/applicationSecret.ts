export interface ApplicationSecret {
  OPENAI_API_KEY: string;
  RENTCAST_API_KEY: string;
  SHOWING_LIST_GENERATION_CONFIG: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export function createApplicationSecret(
  environment: NodeJS.ProcessEnv,
): ApplicationSecret {
  return {
    OPENAI_API_KEY: readRequired(environment, "OPENAI_API_KEY"),
    RENTCAST_API_KEY: readRequired(environment, "RENTCAST_API_KEY"),
    SHOWING_LIST_GENERATION_CONFIG: readRequired(
      environment,
      "SHOWING_LIST_GENERATION_CONFIG",
    ),
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
