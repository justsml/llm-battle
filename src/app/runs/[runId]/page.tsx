import { headers } from "next/headers";

import { BuildOffClient } from "@/components/build-off-client";
import {
  isGitHubAuthConfigured,
  shouldUseLocalDevAuthForHost,
} from "@/lib/auth-config";

type RunPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const { runId } = await params;

  return (
    <BuildOffClient
      authConfig={{
        githubConfigured: isGitHubAuthConfigured(),
        allowLocalDevAutoAuth: shouldUseLocalDevAuthForHost(requestHost),
      }}
      initialRunId={runId}
    />
  );
}
