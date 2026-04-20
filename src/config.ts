import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  DISCORD_REDIRECT_URI: z.string().default(''),
  DISCORD_OAUTH_SCOPES: z.string().default('identify'),
  DISCORD_PUBLIC_KEY: z.string().default(''),
  DISCORD_APPLICATION_ID: z.string().default(''),
  DISCORD_BOT_TOKEN: z.string().default(''),
  DISCORD_API_BASE_URL: z.string().default('https://discord.com/api/v9'),
  DISCORD_METADATA_USER_ID: z.string().default(''),
  DISCORD_METADATA_IDENTITY_ID: z.string().default(''),
  STATSFM_ACCESS_TOKEN: z.string().default(''),
  STATS_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  MANUAL_REFRESH_COOLDOWN_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  STATS_REFRESH_CONCURRENCY: z.coerce.number().int().positive().default(3),
  METRICS_PREFIX: z.string().default('statsfmwidget')
});

export const env = envSchema.parse(process.env);
