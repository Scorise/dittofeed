import { OpenIdProfile } from "backend-lib/src/types";
import { DittofeedFastifyInstance } from "backend-lib/src/types";
import { WORKSPACE_ID_HEADER } from "isomorphic-lib/src/constants";
import fp from "fastify-plugin";

import { OidcSession } from "./routes/callback";

/**
 * Authentication preHandler that bridges OIDC session to request.user.
 * This is the contract expected by getRequestContextFastify() in
 * packages/api/src/buildApp/requestContext.ts:34
 *
 * Also injects the workspace ID header for multi-tenant API requests
 * that don't include workspaceId in query params. Without this, the
 * upstream requestContext check (workspaceId !== workspace.id) fails
 * with 403 when workspaceId is null.
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

    // Inject workspace ID header as fallback for endpoints that omit
    // workspaceId from query/body params (e.g. /api/subscription-management-template).
    // Only inject when no workspaceId exists anywhere in the request — otherwise
    // getWorkspaceIdFromReq() sees two different IDs and returns 400 (MismatchedWorkspaceIds).
    const queryWsId = (request.query as Record<string, unknown>)?.workspaceId;
    const bodyWsId = (request.body as Record<string, unknown>)?.workspaceId;
    const hasWorkspaceId =
      queryWsId || bodyWsId || request.headers[WORKSPACE_ID_HEADER];

    if (session.workspaceId && !hasWorkspaceId) {
      request.headers[WORKSPACE_ID_HEADER] = session.workspaceId;
    }

    return undefined;
  });
});

export default oidcAuth;
