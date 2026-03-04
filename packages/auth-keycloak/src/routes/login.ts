import logger from "backend-lib/src/logger";
import { FastifyInstance } from "fastify";
import { generators } from "openid-client";

import keycloakConfig from "../config";

export default async function loginRoute(fastify: FastifyInstance) {
  fastify.get("/login", async (request, reply) => {
    const config = keycloakConfig();
    const client = fastify.oidcClient;

    // Generate PKCE code verifier and challenge
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const nonce = generators.nonce();
    const state = generators.state();

    // Store PKCE state in session for verification at callback
    request.session.set("oidc-pending", {
      codeVerifier,
      nonce,
      state,
    });

    const authUrl = client.authorizationUrl({
      scope: config.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce,
      state,
    });

    logger().debug({ authUrl }, "Redirecting to Keycloak for login");
    return reply.redirect(authUrl);
  });
}
