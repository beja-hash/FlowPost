import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { getWorkspaceShell } from "@/features/workspaces/server/workspace-service";
import { requireSession } from "@/infrastructure/auth/session";

type DashboardLayoutProps = {
  children: React.ReactNode;
};

function getWorkspaceName(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return `${name.split(" ")[0]} Студия роста`;
  }

  if (email?.trim()) {
    return `${email.split("@")[0]} Студия роста`;
  }

  return "Студия роста";
}

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const session = await requireSession();
  const workspace = await getWorkspaceShell(session.user.id);
  const workspaceName =
    workspace?.name ?? getWorkspaceName(session.user.name, session.user.email);
  const workspacePlan =
    workspace?.plan === "STARTER"
      ? "Старт"
      : workspace?.plan === "PRO"
        ? "Про"
        : "Рост";

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        user={{
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
          role: session.user.status,
        }}
        workspace={{
          name: workspaceName,
          plan: workspacePlan,
          label:
            workspace?.description ??
            "Рабочее пространство для ИИ-контента, публикаций и подключения площадок.",
        }}
      />
      <SidebarInset className="bg-transparent">
        <AppHeader
          workspaceName={workspaceName}
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
            role: session.user.status,
          }}
        />
        <div className="flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
