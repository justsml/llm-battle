import { headers } from "next/headers";

import { BattleClient } from "@/components/battle-client";
import {
  isGitHubAuthConfigured,
  shouldUseLocalDevAuthForHost,
} from "@/lib/auth-config";

type RunAgenticPageProps = {
  searchParams?: Promise<{
    runId?: string;
  }>;
};

export default async function RunAgenticPage({
  searchParams,
}: RunAgenticPageProps) {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const resolvedSearchParams = await searchParams;

  return (
    <BattleClient
      authConfig={{
        githubConfigured: isGitHubAuthConfigured(),
        allowLocalDevAutoAuth: shouldUseLocalDevAuthForHost(requestHost),
      }}
      initialAgenticEnabled
      initialRunId={resolvedSearchParams?.runId ?? null}
    />
  );
}
