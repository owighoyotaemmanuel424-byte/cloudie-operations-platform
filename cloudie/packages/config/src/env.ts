import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  NEXTAUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function parseServerEnv(input: NodeJS.ProcessEnv) {
  return serverEnvSchema.parse(input);
}
