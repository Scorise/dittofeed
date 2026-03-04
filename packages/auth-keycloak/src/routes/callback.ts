import logger from "backend-lib/src/logger";
import { OpenIdProfile } from "backend-lib/src/types";
import { FastifyInstance } from "fastify";

import keycloakConfig from "../config";

interface OidcPendingSession {
  codeVerifier: string;
  nonce: string;
  state: string;
}

export interface OidcSession {
  profile: OpenIdProfile;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  idToken?: string;
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
    const tokenSet = await client.callback(config.callbackUrl, params, {
      code_verifier: pending.codeVerifier,
      nonce: pending.nonce,
      state: pending.state,
    });

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

    // Store OIDC session data
    const oidcSession: OidcSession = {
      profile,
      accessToken: tokenSet.access_token ?? "",
      refreshToken: tokenSet.refresh_token,
      expiresAt: tokenSet.expires_at,
      idToken: tokenSet.id_token,
    };

    request.session.set("oidc", oidcSession);
    request.session.set("oidc-pending", null);

    logger().info(
      { email: profile.email, sub: profile.sub },
      "OIDC login successful",
    );

    return reply.redirect("/");
  });
}
