import { headers } from "next/headers";

import { BuildOffClient } from "@/components/build-off-client";
import {
  isGitHubAuthConfigured,
  shouldUseLocalDevAuthForHost,
} from "@/lib/auth-config";

export default async function HomePage() {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  return (
    <BuildOffClient
      authConfig={{
        githubConfigured: isGitHubAuthConfigured(),
        allowLocalDevAutoAuth: shouldUseLocalDevAuthForHost(requestHost),
      }}
    />
  );
}
