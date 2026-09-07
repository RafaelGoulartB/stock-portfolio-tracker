import {
  CUSTOM_SCORE_VERSION,
  DEFAULT_SCORE_CONFIG,
  type GradeBand,
  type ScoreConfig,
  type ScoreConfigUpdate,
  scoreConfigSchema,
} from "@portifolio-tracker/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { type UserScoreConfigRow, userScoreConfigs } from "../db/schema";

function rowToConfig(row: UserScoreConfigRow): ScoreConfig {
  return scoreConfigSchema.parse({
    version: row.version,
    absoluteWeightCap: row.absoluteWeightCap,
    overweightBlockFactor: row.overweightBlockFactor,
    trimFactor: row.trimFactor,
    cooldownDays: row.cooldownDays,
    gradeWindowQuarters: row.gradeWindowQuarters,
    gradeBands: row.gradeBands,
    ungradedMultiplier: row.ungradedMultiplier,
  });
}

function configValues(config: ScoreConfig) {
  return {
    version: config.version,
    absoluteWeightCap: config.absoluteWeightCap,
    overweightBlockFactor: config.overweightBlockFactor,
    trimFactor: config.trimFactor,
    cooldownDays: config.cooldownDays,
    gradeWindowQuarters: config.gradeWindowQuarters,
    gradeBands: config.gradeBands as GradeBand[],
    ungradedMultiplier: config.ungradedMultiplier,
    updatedAt: new Date(),
  };
}

/** Loads the user's score policy, falling back to the built-in defaults. */
export async function loadScoreConfig(userId: string): Promise<{
  config: ScoreConfig;
  isCustom: boolean;
}> {
  const [row] = await db
    .select()
    .from(userScoreConfigs)
    .where(eq(userScoreConfigs.userId, userId))
    .limit(1);

  if (!row) {
    return { config: DEFAULT_SCORE_CONFIG, isCustom: false };
  }

  return { config: rowToConfig(row), isCustom: true };
}

/** Persists a custom score policy for the user (upsert). */
export async function saveScoreConfig(
  userId: string,
  update: ScoreConfigUpdate,
): Promise<ScoreConfig> {
  const config: ScoreConfig = {
    ...update,
    version: CUSTOM_SCORE_VERSION,
  };

  await db
    .insert(userScoreConfigs)
    .values({ userId, ...configValues(config) })
    .onConflictDoUpdate({
      target: userScoreConfigs.userId,
      set: configValues(config),
    });

  return config;
}

/** Removes a custom policy so the defaults apply again. */
export async function resetScoreConfig(userId: string): Promise<ScoreConfig> {
  await db.delete(userScoreConfigs).where(eq(userScoreConfigs.userId, userId));

  return DEFAULT_SCORE_CONFIG;
}
