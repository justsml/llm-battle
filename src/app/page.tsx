import { headers } from "next/headers";

import { BattleClient } from "@/components/battle-client";
import {
  isGitHubAuthConfigured,
  shouldUseLocalDevAuthForHost,
} from "@/lib/auth-config";

export default async function HomePage() {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  return (
    <BattleClient
      authConfig={{
        githubConfigured: isGitHubAuthConfigured(),
        allowLocalDevAutoAuth: shouldUseLocalDevAuthForHost(requestHost),
      }}
      initialAgenticEnabled={false}
      initialRunId={null}
    />
  );
}
