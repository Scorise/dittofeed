import backendConfig from "backend-lib/src/config";

export interface KeycloakConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string;
  signoutRedirectUrl: string;
}

let CONFIG: KeycloakConfig | null = null;

export default function keycloakConfig(): KeycloakConfig {
  if (!CONFIG) {
    const { openIdClientId, openIdClientSecret, signoutRedirectUrl } =
      backendConfig();

    const issuerUrl = process.env.OIDC_ISSUER_URL;
    if (!issuerUrl) {
      throw new Error("OIDC_ISSUER_URL must be set in multi-tenant mode.");
    }

    const callbackUrl = process.env.OIDC_CALLBACK_URL;
    if (!callbackUrl) {
      throw new Error("OIDC_CALLBACK_URL must be set in multi-tenant mode.");
    }

    if (!openIdClientId) {
      throw new Error(
        "OPEN_ID_CLIENT_ID must be set in multi-tenant mode.",
      );
    }

    if (!openIdClientSecret) {
      throw new Error(
        "OPEN_ID_CLIENT_SECRET must be set in multi-tenant mode.",
      );
    }

    CONFIG = {
      issuerUrl,
      clientId: openIdClientId,
      clientSecret: openIdClientSecret,
      callbackUrl,
      scopes: process.env.OIDC_SCOPES ?? "openid email profile",
      signoutRedirectUrl: signoutRedirectUrl ?? "/",
    };
  }
  return CONFIG;
}
