export const SEED_USERS: ReadonlyArray<{ email: string; name: string; role: "agent" | "admin" }>;
export function seedUsers(
  url: string,
  passwords: { adminPassword: string | undefined; agentPassword: string | undefined },
): Promise<void>;
