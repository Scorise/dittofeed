import logger from "backend-lib/src/logger";
import { FastifyInstance } from "fastify";

import keycloakConfig from "../config";
import { OidcSession } from "./callback";

export default async function signoutRoute(fastify: FastifyInstance) {
  fastify.get("/signout", async (request, reply) => {
    const client = fastify.oidcClient;
    const config = keycloakConfig();

    const session = request.session.get("oidc") as OidcSession | null;
    const idToken = session?.idToken;

    // Clear session
    request.session.delete();

    // Redirect to Keycloak end-session endpoint if we have an id_token
    if (idToken) {
      const endSessionUrl = client.endSessionUrl({
        id_token_hint: idToken,
        post_logout_redirect_uri: config.signoutRedirectUrl,
      });

      logger().debug("Redirecting to Keycloak end-session");
      return reply.redirect(endSessionUrl);
    }

    logger().debug("No id_token, redirecting to signout redirect URL");
    return reply.redirect(config.signoutRedirectUrl);
  });
}
