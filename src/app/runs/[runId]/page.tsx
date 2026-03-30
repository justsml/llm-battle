import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth";
import { ensureSchema, getRun, isDatabaseConfigured } from "@/lib/db";

type RunPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  const requestHeaders = await headers();
  const session = await getServerSession(
    new Request("http://localhost", { headers: requestHeaders }),
  );

  if (!session?.user || !isDatabaseConfigured()) {
    redirect(`/run-generate?runId=${encodeURIComponent(runId)}`);
  }

  try {
    await ensureSchema();
    const run = await getRun(session.user.id, runId);
    const basePath = run?.agentic?.enabled ? "/run-agentic" : "/run-generate";
    redirect(`${basePath}?runId=${encodeURIComponent(runId)}`);
  } catch {
    redirect(`/run-generate?runId=${encodeURIComponent(runId)}`);
  }
}
