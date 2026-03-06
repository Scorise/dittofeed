import { and, eq } from "drizzle-orm";
import {
  bootstrapComputeProperties,
  bootstrapPostgres,
} from "backend-lib/src/bootstrap";
import config from "backend-lib/src/config";
import { db } from "backend-lib/src/db";
import {
  workspaceMember as dbWorkspaceMember,
  workspaceMemberRole as dbWorkspaceMemberRole,
} from "backend-lib/src/db/schema";
import logger from "backend-lib/src/logger";
import { err, ok, Result } from "neverthrow";

import {
  CreateWorkspaceErrorType,
  WorkspaceTypeAppEnum,
} from "backend-lib/src/types";
import { SCORISE_BRANDING } from "./branding";

export interface OnboardResult {
  workspaceId: string;
  isNew: boolean;
}

/**
 * Onboard a user to their own personal workspace.
 *
 * - If the user already has a workspace role, returns the existing workspace.
 * - If not, creates a new workspace (with full bootstrap: user properties,
 *   write keys, providers, subscription groups) and assigns the user as Admin.
 */
export async function onboardUserToOwnWorkspace({
  email,
  name,
}: {
  email: string;
  name?: string;
}): Promise<Result<OnboardResult, Error>> {
  // Check if user already has a workspace
  const existingMember = await db().query.workspaceMember.findFirst({
    where: eq(dbWorkspaceMember.email, email),
  });

  if (existingMember) {
    const existingRole = await db().query.workspaceMemberRole.findFirst({
      where: eq(dbWorkspaceMemberRole.workspaceMemberId, existingMember.id),
    });
    if (existingRole) {
      return ok({
        workspaceId: existingRole.workspaceId,
        isNew: false,
      });
    }
  }

  // Create a new workspace for this user
  const displayName = name || email.split("@")[0];
  const workspaceName = `${displayName}`;

  let result = await bootstrapPostgres({
    workspaceName,
    workspaceType: WorkspaceTypeAppEnum.Root,
    features: SCORISE_BRANDING,
  });

  // If name already taken, retry with email to make it unique
  if (
    result.isErr() &&
    result.error.type === CreateWorkspaceErrorType.WorkspaceAlreadyExists
  ) {
    result = await bootstrapPostgres({
      workspaceName: `${displayName} (${email})`,
      workspaceType: WorkspaceTypeAppEnum.Root,
      features: SCORISE_BRANDING,
    });
  }

  if (result.isErr()) {
    return err(
      new Error(`Failed to create workspace: ${result.error.type}`),
    );
  }

  const workspaceId = result.value.id;

  // Create or find the workspace member and assign Admin role
  let memberId: string;
  if (existingMember) {
    memberId = existingMember.id;
  } else {
    const [inserted] = await db()
      .insert(dbWorkspaceMember)
      .values({ email })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      memberId = inserted.id;
    } else {
      const found = await db().query.workspaceMember.findFirst({
        where: eq(dbWorkspaceMember.email, email),
      });
      if (!found) {
        return err(new Error("Failed to create workspace member"));
      }
      memberId = found.id;
    }
  }

  await db()
    .insert(dbWorkspaceMemberRole)
    .values({
      workspaceId,
      workspaceMemberId: memberId,
      role: "Admin",
    })
    .onConflictDoNothing();

  logger().info(
    { email, workspaceId, workspaceName },
    "Created personal workspace for user",
  );

  // Start compute properties workflow for the new workspace
  if (config().bootstrapWorker) {
    try {
      await bootstrapComputeProperties({ workspaceId });
    } catch (e) {
      logger().warn(
        { err: e, workspaceId },
        "Failed to start compute properties for new workspace",
      );
    }
  }

  return ok({ workspaceId, isNew: true });
}
