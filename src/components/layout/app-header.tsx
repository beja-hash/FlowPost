"use client";

import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { usePathname } from "next/navigation";

import { sidebarLinks } from "@/entities/navigation/sidebar-links";
import { SidebarTrigger } from "@/components/ui/sidebar";

type AppHeaderProps = {
  workspaceName?: string | null;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
    image?: string | null;
  };
};

export function AppHeader({ workspaceName, user }: AppHeaderProps) {
  const pathname = usePathname();
  const activeLink =
    sidebarLinks.find((item) =>
      item.href === "/dashboard"
        ? pathname === item.href
        : pathname.startsWith(item.href),
    ) ?? sidebarLinks[0];

  return (
    <header className="border-border/60 bg-background/86 sticky top-0 z-20 flex h-[4.25rem] items-center justify-between border-b px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -ml-1 rounded-xl"
        />
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs font-medium">
            {workspaceName ?? "Рабочее пространство"}
          </p>
          <div className="flex items-center gap-2">
            <span className="font-heading text-foreground truncate text-base font-semibold tracking-[-0.03em]">
              {activeLink.title}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu
          name={user.name}
          email={user.email}
          role={user.role}
          image={user.image}
        />
      </div>
    </header>
  );
}
