import secureSession from "@fastify/secure-session";
import backendConfig from "backend-lib/src/config";
import { trimTo32Bytes } from "backend-lib/src/crypto";
import logger from "backend-lib/src/logger";
import { DittofeedFastifyInstance } from "backend-lib/src/types";
import fp from "fastify-plugin";
import { Client, Issuer } from "openid-client";

import keycloakConfig from "./config";
import callbackRoute from "./routes/callback";
import loginRoute from "./routes/login";
import signoutRoute from "./routes/signout";

declare module "fastify" {
  interface FastifyInstance {
    oidcClient: Client;
  }
}

const keycloakPlugin = fp(async (fastify: DittofeedFastifyInstance) => {
  const config = keycloakConfig();
  const { secretKey, sessionCookieSecure } = backendConfig();

  if (!secretKey) {
    throw new Error("SECRET_KEY must be set for Keycloak auth.");
  }

  // 1. OIDC Discovery — auto-configures all endpoints from Keycloak
  logger().info({ issuerUrl: config.issuerUrl }, "Discovering OIDC issuer");
  const issuer = await Issuer.discover(config.issuerUrl);
  logger().info(
    { issuer: issuer.metadata.issuer },
    "OIDC issuer discovered",
  );

  // 2. Create OIDC client
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ["code"],
  });

  // 3. Register secure session (reuses existing SECRET_KEY)
  await fastify.register(secureSession, {
    key: trimTo32Bytes(secretKey),
    cookie: {
      path: "/",
      maxAge: 14 * 24 * 60 * 60, // 14 days
      httpOnly: true,
      secure: sessionCookieSecure,
    },
  });

  // 4. Decorate fastify with the OIDC client for route handlers
  fastify.decorate("oidcClient", client);

  // 5. Register OIDC routes under /api/public/oidc
  await fastify.register(
    async (f) => {
      await Promise.all([
        f.register(loginRoute),
        f.register(callbackRoute),
        f.register(signoutRoute),
      ]);
    },
    { prefix: "/api/public/oidc" },
  );
});

export default keycloakPlugin;
