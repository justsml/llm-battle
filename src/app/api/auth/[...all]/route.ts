import { toNextJsHandler } from "better-auth/next-js";

import { auth, ensureAuthSchema } from "@/lib/auth";

export const runtime = "nodejs";

const handler = toNextJsHandler(async (request: Request) => {
  await ensureAuthSchema();
  return auth.handler(request);
});

export const { DELETE, GET, PATCH, POST, PUT } = handler;
