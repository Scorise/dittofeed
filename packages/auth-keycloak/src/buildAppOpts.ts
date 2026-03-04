import { BuildAppOpts } from "api/src/types";

import keycloakPlugin from "./keycloakPlugin";
import oidcAuth from "./oidcAuth";

export function createKeycloakBuildAppOpts(): BuildAppOpts {
  return {
    extendPlugins: async (fastify) => {
      await fastify.register(keycloakPlugin);
    },
    registerAuthentication: async (fastify) => {
      await fastify.register(oidcAuth);
    },
  };
}
