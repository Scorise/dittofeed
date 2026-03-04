import logger from "backend-lib/src/logger";
import { OpenIdProfile } from "backend-lib/src/types";
import { DittofeedFastifyInstance } from "backend-lib/src/types";
import fp from "fastify-plugin";

import { OidcSession } from "./routes/callback";

/**
 * Authentication preHandler that bridges OIDC session to request.user.
 * This is the contract expected by getRequestContextFastify() in
 * packages/api/src/buildApp/requestContext.ts:34
 */
const oidcAuth = fp(async (fastify: DittofeedFastifyInstance) => {
  fastify.addHook("preHandler", async (request, reply) => {
    const session = request.session.get("oidc") as OidcSession | null;

    if (!session?.profile) {
      logger().debug(
        { url: request.url },
        "No OIDC session, returning 401",
      );
      return reply.status(401).send();
    }

    // Check token expiration and attempt refresh if needed
    if (session.expiresAt && session.refreshToken) {
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt - now < 60) {
        try {
          const client = fastify.oidcClient;
          const tokenSet = await client.refresh(session.refreshToken);
          const claims = tokenSet.claims();

          const profile: OpenIdProfile = {
            sub: claims.sub,
            email: (claims.email as string) ?? session.profile.email,
            email_verified:
              claims.email_verified ?? session.profile.email_verified,
            picture: (claims.picture as string) ?? session.profile.picture,
            name: (claims.name as string) ?? session.profile.name,
            nickname:
              (claims.preferred_username as string) ??
              claims.name ??
              session.profile.nickname,
          };

          request.session.set("oidc", {
            profile,
            accessToken: tokenSet.access_token ?? "",
            refreshToken: tokenSet.refresh_token ?? session.refreshToken,
            expiresAt: tokenSet.expires_at,
            idToken: tokenSet.id_token ?? session.idToken,
          } satisfies OidcSession);

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          (request as { user?: OpenIdProfile }).user = profile;
          return undefined;
        } catch (err) {
          logger().warn({ err }, "Token refresh failed, clearing session");
          request.session.delete();
          return reply.status(401).send();
        }
      }
    }

    // Set request.user for the existing request context pipeline
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    (request as { user?: OpenIdProfile }).user = session.profile;
    return undefined;
  });
});

export default oidcAuth;
