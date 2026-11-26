import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit faire au moins 32 caractères'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY est requis'),
  SMS_PROVIDER: z.enum(['console', 'mailhog', 'real']).default('console'),
  PAYMENT_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('no-reply@tontine.local'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DEFAULT_CURRENCY: z.literal('XAF').default('XAF'),
  TZ: z.string().default('Africa/Douala'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
  MOCK_PROVIDER_WEBHOOK_SECRET: z.string().default('dev-mock-webhook-secret'),
  /** Le mock envoie automatiquement un webhook signé quelques secondes après la collecte. */
  MOCK_PROVIDER_AUTO_CONFIRM: z.enum(['true', 'false']).default('true'),
  /** Faire confiance à X-Forwarded-For (uniquement derrière un proxy maîtrisé). */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  REAL_PROVIDER_API_KEY: z.string().optional(),
  REAL_PROVIDER_WEBHOOK_SECRET: z.string().optional(),
  /** Code OTP imposé, réservé au développement et aux tests automatisés. */
  OTP_FIXED_CODE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  ),
  MAILHOG_UI_PORT: z.coerce.number().int().positive().default(8025),
});

const parsedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  if (env.CORS_ORIGINS.includes('*')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGINS'],
      message: 'Une origine générique est interdite en production (credentials activés).',
    });
  }
  if (env.MOCK_PROVIDER_WEBHOOK_SECRET === 'dev-mock-webhook-secret') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MOCK_PROVIDER_WEBHOOK_SECRET'],
      message: 'Le secret de webhook de développement est interdit en production.',
    });
  }
  if (env.OTP_FIXED_CODE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OTP_FIXED_CODE'],
      message: 'Un code OTP fixe est interdit en production.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validation stricte des variables d'environnement : l'API refuse de démarrer
 * si une variable obligatoire manque ou est malformée.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = parsedEnvSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration invalide -> ${details}`);
  }

  return result.data;
}
