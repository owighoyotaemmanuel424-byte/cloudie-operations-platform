import { useNavigate } from "react-router";
import { toast } from "sonner";
import { LogOut, Settings, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserMenuProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

function initialsFor(name: string | null | undefined, email: string | undefined) {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email?.[0]?.toUpperCase() ?? "C";
}

/**
 * Account footer: avatar, name, truncated email, and the product's **only**
 * sign-out control.
 *
 * Everything else in the navigation is a link. Nothing here calls
 * `logout()`, `reset()` or `window.location.reload()` — closing a drawer, a
 * resize or a route change can therefore never end a session.
 */
export function UserMenu({ collapsed = false, onNavigate }: UserMenuProps) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();

  const displayName = user?.name?.trim() || user?.email || "Signed in";
  const email = user?.email ?? "";

  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };

  const handleSignOut = async () => {
    onNavigate?.();
    const result = await signOut();
    if (!result.ok) {
      // Never report a logout that did not happen. The local session is gone
      // (that is what `signOut` guarantees), so /login is still correct.
      toast.error("Signed out of this device, but the server session may still be open.", {
        description: result.error,
      });
    }
    navigate("/login", { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg text-left",
            "transition-colors duration-200 hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
            collapsed ? "justify-center px-0 py-2" : "px-2 py-2",
          )}
        >
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-surface-2 text-[11px] font-semibold text-foreground">
              {initialsFor(user?.name, user?.email)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground">
                {displayName}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {email || "No email on file"}
              </span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{displayName}</span>
          <span className="block truncate text-[11px] font-normal text-muted-foreground">
            {email || "No email on file"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => go("/settings")}>
          <UserRound className="mr-2 size-4" aria-hidden />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go("/settings")}>
          <Settings className="mr-2 size-4" aria-hidden />
          Sessions
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {/* Cloudie ships one dark palette (see ThemeProvider). The other two
            values are listed so the menu matches the product spec, but they are
            disabled rather than silently doing nothing. */}
        <DropdownMenuRadioGroup value="dark">
          <DropdownMenuRadioItem value="system" disabled title="Cloudie ships one dark palette">
            System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" disabled title="Cloudie ships one dark palette">
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void handleSignOut()}>
          <LogOut className="mr-2 size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
