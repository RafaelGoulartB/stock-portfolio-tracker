import { Trans } from "@lingui/react/macro";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Up to two initials from the account email, e.g. `rafael.silva@…` → `RS`. */
export function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");

  return letters.join("").toUpperCase() || "?";
}

/**
 * Account control: an initials avatar that opens a menu with the signed-in
 * email and the sign-out action, keeping the header compact on all sizes.
 */
export function UserMenu({
  email,
  signingOut,
  onSignOut,
}: {
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={email}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="bg-primary text-primary-foreground">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {initialsOf(email)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="min-w-0">
          <span className="block truncate font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden="true" />
          <Trans id="shell.signOut">Sign out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
