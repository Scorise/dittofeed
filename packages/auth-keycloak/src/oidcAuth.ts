import { OpenIdProfile } from "backend-lib/src/types";
import { DittofeedFastifyInstance } from "backend-lib/src/types";
import fp from "fastify-plugin";

import { OidcSession } from "./routes/callback";

/**
 * Authentication preHandler that bridges OIDC session to request.user.
 * This is the contract expected by getRequestContextFastify() in
 * packages/api/src/buildApp/requestContext.ts:34
 *
 * Uses fastify-plugin (fp) so the hook is available in all scopes
 * including /api. Safe because this plugin never blocks requests —
 * it only sets request.user when a valid session exists.
 */
const oidcAuth = fp(async (fastify: DittofeedFastifyInstance) => {
  fastify.addHook("preHandler", async (request) => {
    const session = request.session?.get("oidc") as OidcSession | null;

    if (!session?.profile) {
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    (request as { user?: OpenIdProfile }).user = session.profile;
    return undefined;
  });
});

export default oidcAuth;
