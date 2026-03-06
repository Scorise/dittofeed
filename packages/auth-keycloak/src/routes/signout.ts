import logger from "backend-lib/src/logger";
import { FastifyInstance } from "fastify";

import keycloakConfig from "../config";

export default async function signoutRoute(fastify: FastifyInstance) {
  fastify.get("/signout", async (request, reply) => {
    const client = fastify.oidcClient;
    const config = keycloakConfig();

    // Clear session
    request.session.delete();

    // Redirect to Keycloak end-session endpoint (without id_token_hint
    // since tokens are not stored in the cookie session for size reasons)
    const endSessionUrl = client.endSessionUrl({
      post_logout_redirect_uri: config.signoutRedirectUrl,
    });

    logger().debug("Redirecting to Keycloak end-session");
    return reply.redirect(endSessionUrl);
  });
}
