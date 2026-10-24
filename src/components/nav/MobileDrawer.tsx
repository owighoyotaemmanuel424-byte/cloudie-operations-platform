import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useSession } from "@/hooks/useSession";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { UserMenu } from "./UserMenu";
import { ADMIN_ACCENT, ADMIN_LINK, SECONDARY_LINKS, isAdminRole } from "./navItems";

type MobileDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The phone navigation surface, built on Radix Dialog via `Sheet`.
 *
 * Radix owns the focus trap, the initial focus, the Escape key, backdrop taps
 * and returning focus to the hamburger; none of that is hand-rolled here. Only
 * the `open` prop flips when this closes — `<Outlet />` is rendered by the
 * shell, not by the drawer, so closing it never unmounts the page.
 *
 * A 320ms slide, and no motion at all under `prefers-reduced-motion`.
 */
export function MobileDrawer({ open, onOpenChange }: MobileDrawerProps) {
  const active = useActiveWorkspace();
  const { user } = useSession();
  const isAdmin = isAdminRole(user?.role);
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className={cn(
          "flex w-[85vw] max-w-[320px] flex-col gap-0 border-r border-border bg-sidebar p-0",
          "sm:max-w-[320px]",
          "data-[state=open]:duration-[320ms] data-[state=closed]:duration-[320ms]",
          "ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
          "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
        )}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Workspaces, settings and your account.
        </SheetDescription>

        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-3 pr-12">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-[13px] font-bold text-foreground">
            C
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight tracking-tight text-foreground">
              Cloudie
            </span>
            <span className="flex items-center gap-1.5 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", active.accent.dot)}
              />
              <span className="truncate">{active.label}</span>
            </span>
          </span>
        </div>

        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <WorkspaceSwitcher variant="drawer" onNavigate={close} />

          <div className="my-3 border-t border-border" role="presentation" />

          <ul className="flex flex-col gap-0.5" role="list">
            {SECONDARY_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <li key={link.href}>
                  <DrawerLink href={link.href} label={link.label} onNavigate={close}>
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                  </DrawerLink>
                </li>
              );
            })}

            {isAdmin && (
              <li>
                <DrawerLink href={ADMIN_LINK.href} label={ADMIN_LINK.label} onNavigate={close} accent>
                  <ADMIN_LINK.icon
                    className={cn("size-5 shrink-0", ADMIN_ACCENT.text)}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </DrawerLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-border p-2">
          <UserMenu onNavigate={close} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerLink({
  href,
  label,
  onNavigate,
  accent = false,
  children,
}: {
  href: string;
  label: string;
  onNavigate: () => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      onClick={onNavigate}
      className={cn(
        "relative flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground",
        "transition-[background-color,color] duration-200 hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
      )}
    >
      {accent && (
        <span aria-hidden className={cn("absolute left-0 h-5 w-[3px] rounded-r-full", ADMIN_ACCENT.bar)} />
      )}
      {children}
      <span className="truncate">{label}</span>
    </Link>
  );
}
