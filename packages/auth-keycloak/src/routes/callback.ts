import logger from "backend-lib/src/logger";
import { OpenIdProfile } from "backend-lib/src/types";
import { FastifyInstance } from "fastify";

import keycloakConfig from "../config";
import { onboardUserToOwnWorkspace } from "../onboarding";

interface OidcPendingSession {
  codeVerifier: string;
  nonce: string;
  state: string;
}

// Session stored in a cookie — must stay under 4KB after encryption+base64.
// Only profile is stored. Tokens are omitted to keep the cookie small.
export interface OidcSession {
  profile: OpenIdProfile;
  workspaceId?: string;
}

export default async function callbackRoute(fastify: FastifyInstance) {
  fastify.get("/callback", async (request, reply) => {
    const client = fastify.oidcClient;
    const config = keycloakConfig();

    // Retrieve PKCE state from session
    const pending = request.session.get(
      "oidc-pending",
    ) as OidcPendingSession | null;
    if (!pending) {
      logger().warn("Missing OIDC pending session at callback");
      return reply.status(400).send("Missing OIDC session state. Please try logging in again.");
    }

    // Exchange authorization code for tokens
    const params = client.callbackParams(request.raw);
    let tokenSet;
    try {
      tokenSet = await client.callback(config.callbackUrl, params, {
        code_verifier: pending.codeVerifier,
        nonce: pending.nonce,
        state: pending.state,
      });
    } catch (err) {
      logger().warn({ err }, "OIDC token exchange failed, redirecting to login");
      request.session.set("oidc-pending", null);
      return reply.redirect("/api/public/oidc/login");
    }

    const claims = tokenSet.claims();

    // Map Keycloak claims to OpenIdProfile shape expected by Dittofeed
    const profile: OpenIdProfile = {
      sub: claims.sub,
      email: (claims.email as string) ?? "",
      email_verified: claims.email_verified ?? false,
      picture: claims.picture as string | undefined,
      name: claims.name as string | undefined,
      nickname: (claims.preferred_username as string) ?? claims.name,
    };

    request.session.set("oidc-pending", null);

    // Auto-provision personal workspace for Keycloak users.
    // First login: creates a new workspace with full bootstrap (user properties,
    // write keys, providers, subscription groups) and assigns user as Admin.
    // Subsequent logins: returns the existing workspace.
    let workspaceId: string | undefined;
    if (profile.email) {
      const onboardResult = await onboardUserToOwnWorkspace({
        email: profile.email,
        name: profile.name,
      });
      if (onboardResult.isErr()) {
        logger().warn(
          { err: onboardResult.error, email: profile.email },
          "Auto-onboarding failed",
        );
      } else {
        workspaceId = onboardResult.value.workspaceId;
        if (onboardResult.value.isNew) {
          logger().info(
            { email: profile.email, workspaceId },
            "Created new personal workspace",
          );
        }
      }
    }

    const oidcSession: OidcSession = {
      profile,
      workspaceId,
    };
    request.session.set("oidc", oidcSession);

    logger().info(
      { email: profile.email, sub: profile.sub, workspaceId },
      "OIDC login successful",
    );

    return reply.redirect("/dashboard/");
  });
}
