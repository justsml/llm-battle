import { randomUUID } from "node:crypto";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

const DEV_FALLBACK_AUTH_SECRET = "development-only-better-auth-secret-change-me";

type GlobalAuthState = typeof globalThis & {
  __betterAuthDb?: Kysely<Record<string, never>>;
  __betterAuthPool?: Pool;
  __betterAuthSchemaPromise?: Promise<void> | null;
};

const globalAuthState = globalThis as GlobalAuthState;

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for Better Auth.");
  }

  return url;
}

function getAuthPool() {
  if (globalAuthState.__betterAuthPool) {
    return globalAuthState.__betterAuthPool;
  }

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
  });

  globalAuthState.__betterAuthPool = pool;
  return pool;
}

function getAuthDb() {
  if (globalAuthState.__betterAuthDb) {
    return globalAuthState.__betterAuthDb;
  }

  const db = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({
      pool: getAuthPool(),
    }),
  });

  globalAuthState.__betterAuthDb = db;
  return db;
}

const socialProviders =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          scope: ["read:user", "user:email"],
        },
      }
    : {};

export const auth = betterAuth({
  appName: "LLM Build-Off",
  baseURL: process.env.BETTER_AUTH_URL,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? DEV_FALLBACK_AUTH_SECRET : undefined),
  database: {
    db: getAuthDb(),
    type: "postgres",
  },
  socialProviders,
  plugins: [nextCookies()],
  advanced: {
    database: {
      generateId: () => randomUUID(),
    },
  },
});

export async function ensureAuthSchema() {
  if (!globalAuthState.__betterAuthSchemaPromise) {
    globalAuthState.__betterAuthSchemaPromise = (async () => {
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
    })().catch((error) => {
      globalAuthState.__betterAuthSchemaPromise = null;
      throw error;
    });
  }

  await globalAuthState.__betterAuthSchemaPromise;
}

export async function getServerSession(request: Request) {
  await ensureAuthSchema();
  return auth.api.getSession({
    headers: request.headers,
  });
}
