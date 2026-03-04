// ensures types are imported to support secure-session
import "@fastify/secure-session";

import { Worker } from "@temporalio/worker";
import { BOOTSTRAP_OPTIONS } from "admin-cli/src/bootstrap";
import { requestToSessionValue } from "api/src/buildApp/requestContext";
import backendConfig from "backend-lib/src/config";
import { startBootstrapWorkflow } from "backend-lib/src/journeys/bootstrap/lifecycle";
import logger from "backend-lib/src/logger";
import { OpenIdProfile } from "backend-lib/src/types";
import liteConfig from "lite/src/config";
import { initLiteOpenTelemetry } from "lite/src/openTelemetry";
import next from "next";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { createKeycloakBuildAppOpts } from "../src/buildAppOpts";
import { OidcSession } from "../src/routes/callback";

const otel = initLiteOpenTelemetry();

// Importing buildApp and buildWorker after otel initialization to allow monkey patching
// eslint-disable-next-line import/first, import/order
import buildApp from "api/src/buildApp";
// eslint-disable-next-line import/first, import/order
import { buildWorker } from "worker/src/buildWorker";

function findPackagesDir(fullPath: string): string {
  const normalizedPath = path.normalize(fullPath);
  const segments = normalizedPath.split(path.sep);

  // Find the rightmost "packages" directory followed by "auth-keycloak"
  let lastPackagesIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === "packages" && segments[i + 1] === "auth-keycloak") {
      lastPackagesIndex = i;
      break;
    }
  }

  if (lastPackagesIndex === -1) {
    throw new Error("Could not find packages directory.");
  }

  return segments.slice(0, lastPackagesIndex + 1).join(path.sep);
}

async function startLite() {
  if (backendConfig().logConfig) {
    logger().info(
      {
        ...backendConfig(),
        ...liteConfig,
      },
      "Initialized with config",
    );
  }

  // KEY DIFFERENCE: pass Keycloak auth opts to buildApp
  const app = await buildApp(createKeycloakBuildAppOpts());

  if (backendConfig().bootstrap) {
    logger().info("Bootstrapping");
    const args = await yargs(hideBin(process.argv)).options(BOOTSTRAP_OPTIONS)
      .argv;

    await startBootstrapWorkflow(args);
  } else {
    logger().info("Skipping bootstrap");
  }

  const { port, host, nodeEnv } = liteConfig();

  const relativeDir = "dashboard";
  const packagesDir = findPackagesDir(__dirname);
  const dir = path.resolve(packagesDir, relativeDir);
  logger().debug(
    { dir, dirname: __dirname, packagesDir },
    "Next.js app directory",
  );

  const nextApp = next({
    dev: nodeEnv === "development",
    dir,
    customServer: true,
  });
  await nextApp.prepare();
  const nextHandler = nextApp.getRequestHandler();

  app.route({
    // Exclude 'OPTIONS to avoid conflict with cors plugin'
    method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
    url: "/*",
    handler: async (req, reply) => {
      // Bridge OIDC session profile to Next.js SSR context
      // This is read by packages/dashboard/src/lib/requestContext.ts:30
      const oidcSession = req.session?.get("oidc") as OidcSession | null;
      if (oidcSession?.profile) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, no-param-reassign
        (req.raw as { profile?: OpenIdProfile }).profile =
          oidcSession.profile;
      }

      // eslint-disable-next-line no-param-reassign
      req.raw.headers = {
        ...req.raw.headers,
        ...requestToSessionValue(req),
      };
      await nextHandler(req.raw, reply.raw);

      // eslint-disable-next-line no-param-reassign
      reply.sent = true;
    },
  });

  let worker: Worker | null = null;

  if (liteConfig().enableWorker) {
    worker = await buildWorker(otel);
  }

  otel.start();

  await Promise.all([app.listen({ port, host }), worker?.run()]);
}

startLite()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("automate with Keycloak auth started");
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
