import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Header shortcut to the transactions page, where trades are entered. */
export function AddTransactionButton() {
  const { i18n } = useLingui();
  const label = i18n._(
    msg({ id: "nav.addTransaction", message: "Add transaction" }),
  );

  return (
    <Button
      asChild
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
    >
      <Link
        to="/transactions"
        activeProps={{ className: "bg-accent text-accent-foreground" }}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}
