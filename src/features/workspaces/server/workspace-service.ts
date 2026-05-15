import { Prisma, UserStatus, WorkspacePlan, WorkspaceRole } from "@prisma/client";

import { prisma } from "@/infrastructure/db/prisma";
import { debugLog } from "@/lib/debug-log";
import { slugify } from "@/lib/slugify";

function buildWorkspaceName(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return `${name.split(" ")[0]} Студия роста`;
  }

  if (email?.trim()) {
    return `${email.split("@")[0]} Студия роста`;
  }

  return "Студия роста";
}

async function generateWorkspaceSlug(userId: string, input: string) {
  const baseSlug = slugify(input) || "growth-lab";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const existing = await prisma.workspace.findFirst({
      where: {
        ownerId: userId,
        slug: candidate,
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Не удалось создать уникальный адрес рабочего пространства.");
}

export async function provisionWorkspaceForUser(params: {
  userId: string;
  name?: string | null;
  email?: string | null;
  timezone?: string | null;
}) {
  debugLog("[workspace:provision] start", { userId: params.userId });
  debugLog("[workspace:provision] before prisma.workspaceMember.findFirst");
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: params.userId },
    select: { workspaceId: true },
  });
  debugLog("[workspace:provision] after prisma.workspaceMember.findFirst", {
    userId: params.userId,
    hasMembership: Boolean(membership),
  });

  if (membership) {
    debugLog("[workspace:provision] existing workspace", {
      workspaceId: membership.workspaceId,
    });
    return membership.workspaceId;
  }

  const workspaceName = buildWorkspaceName(params.name, params.email);
  const workspaceSlug = await generateWorkspaceSlug(params.userId, workspaceName);

  debugLog("[workspace:provision] before prisma.workspace.create", {
    userId: params.userId,
    workspaceSlug,
  });
  const workspace = await prisma.workspace.create({
    data: {
      ownerId: params.userId,
      name: workspaceName,
      slug: workspaceSlug,
      plan: WorkspacePlan.GROWTH,
      timezone: params.timezone?.trim() || "UTC",
      description:
        "Рабочее пространство для ИИ-контента, публикаций, площадок и аналитики.",
      members: {
        create: {
          userId: params.userId,
          role: WorkspaceRole.OWNER,
        },
      },
    },
    select: { id: true },
  });
  debugLog("[workspace:provision] after prisma.workspace.create", {
    workspaceId: workspace.id,
  });

  return workspace.id;
}

export async function getWorkspaceShell(userId: string) {
  try {
    debugLog("[workspace:shell] before prisma.workspaceMember.findFirst", {
      userId,
    });
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        user: { status: UserStatus.ACTIVE },
      },
      orderBy: {
        joinedAt: "asc",
      },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            plan: true,
            description: true,
          },
        },
      },
    });
    debugLog("[workspace:shell] after prisma.workspaceMember.findFirst", {
      userId,
      hasMembership: Boolean(membership),
    });

    return membership
      ? {
          id: membership.workspace.id,
          name: membership.workspace.name,
          plan: membership.workspace.plan,
          description: membership.workspace.description,
          role: membership.role,
        }
      : null;
  } catch (error) {
    console.error("[workspace:shell] failed", error);
    return null;
  }
}

export async function ensureUserWorkspace(userId: string) {
  const existing = await getWorkspaceShell(userId);

  if (existing) {
    return existing;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      timezone: true,
      status: true,
    },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new Error("Пользователь не найден или неактивен.");
  }

  const workspaceName = buildWorkspaceName(user.name, user.email);
  const fallbackSlug = `workspace-${user.id}`;

  try {
    return await prisma.$transaction(async (tx) => {
      const membership = await tx.workspaceMember.findFirst({
        where: { userId },
        orderBy: { joinedAt: "asc" },
        select: {
          role: true,
          workspace: {
            select: {
              id: true,
              name: true,
              plan: true,
              description: true,
            },
          },
        },
      });

      if (membership) {
        return {
          id: membership.workspace.id,
          name: membership.workspace.name,
          plan: membership.workspace.plan,
          description: membership.workspace.description,
          role: membership.role,
        };
      }

      const ownedWorkspace = await tx.workspace.findFirst({
        where: { ownerId: userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          plan: true,
          description: true,
        },
      });

      if (ownedWorkspace) {
        const member = await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: ownedWorkspace.id,
              userId,
            },
          },
          update: {
            role: WorkspaceRole.OWNER,
          },
          create: {
            workspaceId: ownedWorkspace.id,
            userId,
            role: WorkspaceRole.OWNER,
          },
          select: { role: true },
        });

        return {
          id: ownedWorkspace.id,
          name: ownedWorkspace.name,
          plan: ownedWorkspace.plan,
          description: ownedWorkspace.description,
          role: member.role,
        };
      }

      const workspace = await tx.workspace.create({
        data: {
          ownerId: userId,
          name: workspaceName,
          slug: fallbackSlug,
          plan: WorkspacePlan.GROWTH,
          timezone: user.timezone || "UTC",
          description:
            "Рабочее пространство для ИИ-контента, публикаций, площадок и аналитики.",
          members: {
            create: {
              userId,
              role: WorkspaceRole.OWNER,
            },
          },
        },
        select: {
          id: true,
          name: true,
          plan: true,
          description: true,
          members: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
      });

      return {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        description: workspace.description,
        role: workspace.members[0]?.role ?? WorkspaceRole.OWNER,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const workspace = await getWorkspaceShell(userId);

      if (workspace) {
        return workspace;
      }
    }

    throw error;
  }
}

export async function requireWorkspaceForUser(userId: string) {
  const workspace = await getWorkspaceShell(userId);

  if (!workspace) {
    throw new Error("Рабочее пространство пользователя не найдено.");
  }

  return workspace;
}
