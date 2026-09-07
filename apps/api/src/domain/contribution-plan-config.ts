import {
  type ContributionPlanConfig,
  type ContributionPlanConfigUpdate,
  CUSTOM_CONTRIBUTION_PLAN_VERSION,
  contributionPlanConfigSchema,
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
} from "@portifolio-tracker/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  type UserContributionPlanConfigRow,
  userContributionPlanConfigs,
} from "../db/schema";

function rowToConfig(
  row: UserContributionPlanConfigRow,
): ContributionPlanConfig {
  return contributionPlanConfigSchema.parse({
    version: row.version,
    smallBookImpact: row.smallBookImpact,
    largeBookImpact: row.largeBookImpact,
    maxShare: row.maxShare,
    maxAssets: row.maxAssets,
  });
}

function configValues(config: ContributionPlanConfig) {
  return {
    version: config.version,
    smallBookImpact: config.smallBookImpact,
    largeBookImpact: config.largeBookImpact,
    maxShare: config.maxShare,
    maxAssets: config.maxAssets,
    updatedAt: new Date(),
  };
}

/** Loads the user's planner policy, falling back to the built-in defaults. */
export async function loadContributionPlanConfig(userId: string): Promise<{
  config: ContributionPlanConfig;
  isCustom: boolean;
}> {
  const [row] = await db
    .select()
    .from(userContributionPlanConfigs)
    .where(eq(userContributionPlanConfigs.userId, userId))
    .limit(1);

  if (!row) {
    return { config: DEFAULT_CONTRIBUTION_PLAN_CONFIG, isCustom: false };
  }

  return { config: rowToConfig(row), isCustom: true };
}

/** Persists a custom planner policy for the user (upsert). */
export async function saveContributionPlanConfig(
  userId: string,
  update: ContributionPlanConfigUpdate,
): Promise<ContributionPlanConfig> {
  const config: ContributionPlanConfig = {
    ...update,
    version: CUSTOM_CONTRIBUTION_PLAN_VERSION,
  };

  await db
    .insert(userContributionPlanConfigs)
    .values({ userId, ...configValues(config) })
    .onConflictDoUpdate({
      target: userContributionPlanConfigs.userId,
      set: configValues(config),
    });

  return config;
}

/** Removes a custom policy so the defaults apply again. */
export async function resetContributionPlanConfig(
  userId: string,
): Promise<ContributionPlanConfig> {
  await db
    .delete(userContributionPlanConfigs)
    .where(eq(userContributionPlanConfigs.userId, userId));

  return DEFAULT_CONTRIBUTION_PLAN_CONFIG;
}
