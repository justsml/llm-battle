import { headers } from "next/headers";

import { BuildOffClient } from "@/components/build-off-client";
import {
  isGitHubAuthConfigured,
  shouldUseLocalDevAuthForHost,
} from "@/lib/auth-config";

type RunGeneratePageProps = {
  searchParams?: Promise<{
    runId?: string;
  }>;
};

export default async function RunGeneratePage({
  searchParams,
}: RunGeneratePageProps) {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const resolvedSearchParams = await searchParams;

  return (
    <BuildOffClient
      authConfig={{
        githubConfigured: isGitHubAuthConfigured(),
        allowLocalDevAutoAuth: shouldUseLocalDevAuthForHost(requestHost),
      }}
      initialAgenticEnabled={false}
      initialRunId={resolvedSearchParams?.runId ?? null}
    />
  );
}
