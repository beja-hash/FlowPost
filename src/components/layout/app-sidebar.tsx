"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand } from "@/components/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { sidebarLinks } from "@/entities/navigation/sidebar-links";

type AppSidebarProps = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
    image?: string | null;
  };
  workspace: {
    name?: string | null;
    plan?: string | null;
    label?: string | null;
  };
};

export function AppSidebar({ user, workspace }: AppSidebarProps) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  void user;
  void workspace;

  return (
    <Sidebar
      collapsible="icon"
      variant="sidebar"
      className="border-sidebar-border/60 bg-sidebar/95 border-r"
    >
      <SidebarHeader
        className={cn(
          "border-sidebar-border/45 border-b px-4 py-4 transition-all duration-200",
          collapsed && "items-center px-2",
        )}
      >
        <Brand compact={collapsed} tone="sidebar" />
      </SidebarHeader>
      <SidebarContent className="px-3 py-4 group-data-[collapsible=icon]:px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {sidebarLinks.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === item.href
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.title}
                      size="lg"
                      className="text-sidebar-foreground/72 hover:bg-sidebar-accent/75 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-foreground h-11 rounded-2xl px-3 text-[0.9rem] font-medium transition-all duration-200 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! hover:translate-x-0.5 data-active:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                    >
                      <item.icon className="text-sidebar-foreground/70 group-data-[active=true]/menu-button:text-sidebar-foreground transition-colors" />
                      <span className="transition-opacity duration-200 group-data-[collapsible=icon]:sr-only">
                        {item.title}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
