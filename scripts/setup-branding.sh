#!/bin/bash
# Setup Scorise branding for Dittofeed using the WhiteLabel feature.
#
# This script configures the WhiteLabel feature for all workspaces
# (or a specific workspace) via the admin-cli container.
#
# Usage:
#   ./scripts/setup-branding.sh                     # applies to ALL workspaces
#   ./scripts/setup-branding.sh <workspace-id>      # applies to a specific workspace
#
# Prerequisites:
#   - docker compose services must be running (./start)
#   - admin-cli profile must be started:
#     docker compose -f docker-compose.lite.yaml -f docker-compose.keycloak.yaml --profile admin-cli up -d admin-cli

set -euo pipefail

# --- Configuration ---
APP_TITLE="Scorise Automate"
NAV_CARD_TITLE="Scorise"
NAV_CARD_DESCRIPTION="Marketing Automation"

# Asset URLs served by Next.js dashboard from public/branding-assets/
# These files live in packages/dashboard/public/branding-assets/
# and are served at /dashboard/branding-assets/ (due to basePath: "/dashboard").
# If nginx is in front, /assets/ paths also work (see nginx/assets/).
FAVICON_URL="/dashboard/branding-assets/favicon-scorise.png"
NAV_CARD_ICON_URL="/dashboard/branding-assets/scorise-logo.jpg"

COMPOSE_FILES="-f docker-compose.lite.yaml -f docker-compose.keycloak.yaml"
ADMIN_CLI_SERVICE="admin-cli"

# --- Build the features JSON ---
FEATURES_JSON=$(cat <<ENDJSON
[{"type":"WhiteLabel","title":"${APP_TITLE}","favicon":"${FAVICON_URL}","navCardTitle":"${NAV_CARD_TITLE}","navCardDescription":"${NAV_CARD_DESCRIPTION}","navCardIcon":"${NAV_CARD_ICON_URL}"}]
ENDJSON
)

echo "Scorise branding configuration:"
echo "  Title:           ${APP_TITLE}"
echo "  Favicon:         ${FAVICON_URL}"
echo "  Nav Card Title:  ${NAV_CARD_TITLE}"
echo "  Nav Card Desc:   ${NAV_CARD_DESCRIPTION}"
echo "  Nav Card Icon:   ${NAV_CARD_ICON_URL}"
echo ""

apply_branding() {
  local ws_id="$1"
  echo "Applying branding to workspace: ${ws_id}"
  docker compose ${COMPOSE_FILES} exec -T "${ADMIN_CLI_SERVICE}" \
    node packages/admin-cli/dist/scripts/cli.js add-features \
      --workspace-id "${ws_id}" \
      --features "${FEATURES_JSON}"
  echo "  Done."
}

if [ -n "${1:-}" ]; then
  # Apply to a specific workspace
  apply_branding "$1"
else
  # Fetch all workspace IDs from the database
  echo "Fetching all workspace IDs..."
  WORKSPACE_IDS=$(docker compose ${COMPOSE_FILES} exec -T postgres \
    psql -U "${DATABASE_USER:-postgres}" -d dittofeed -t -A \
    -c 'SELECT id FROM "Workspace";')

  if [ -z "${WORKSPACE_IDS}" ]; then
    echo "ERROR: No workspaces found in database."
    exit 1
  fi

  # Read IDs into array to avoid stdin issues with docker compose exec
  mapfile -t WS_ARRAY <<< "${WORKSPACE_IDS}"

  echo "Found workspaces:"
  for ws_id in "${WS_ARRAY[@]}"; do
    [ -z "${ws_id}" ] && continue
    echo "  - ${ws_id}"
  done
  echo ""

  for ws_id in "${WS_ARRAY[@]}"; do
    [ -z "${ws_id}" ] && continue
    apply_branding "${ws_id}"
  done
fi

echo ""
echo "Branding setup complete! Refresh the dashboard to see changes."
