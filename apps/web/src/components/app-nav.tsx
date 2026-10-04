import { Trans } from "@lingui/react/macro";
import { Link, type LinkProps, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  CalendarDays,
  Check,
  ChevronDown,
  Coins,
  Flag,
  Landmark,
  type LucideIcon,
  PieChart,
  ScanSearch,
  TableProperties,
  Tags,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type NavItem = {
  to: NonNullable<LinkProps["to"]>;
  icon: LucideIcon;
  label: ReactNode;
};

type NavGroup = {
  id: string;
  icon: LucideIcon;
  label: ReactNode;
  items: NavItem[];
};

/** Secondary sections shown after the primary allocation link. */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "portfolio",
    icon: Wallet,
    label: <Trans id="nav.portfolio">Portfolio</Trans>,
    items: [
      {
        to: "/positions",
        icon: PieChart,
        label: <Trans id="nav.positions">Positions</Trans>,
      },
      {
        to: "/detailed-positions",
        icon: TableProperties,
        label: <Trans id="nav.detailedPositions">Detailed positions</Trans>,
      },
      {
        to: "/transactions",
        icon: ArrowLeftRight,
        label: <Trans id="nav.transactions">Transactions</Trans>,
      },
      {
        to: "/categories",
        icon: Tags,
        label: <Trans id="nav.categories">My categories</Trans>,
      },
    ],
  },
  {
    id: "analysis",
    icon: TrendingUp,
    label: <Trans id="nav.analysis">Analysis</Trans>,
    items: [
      {
        to: "/daily",
        icon: Activity,
        label: <Trans id="nav.daily">Daily</Trans>,
      },
      {
        to: "/performance",
        icon: TrendingUp,
        label: <Trans id="nav.performance">Performance</Trans>,
      },
      {
        to: "/deep-finder",
        icon: ScanSearch,
        label: <Trans id="nav.deepFinder">Deep Finder</Trans>,
      },
      {
        to: "/goals",
        icon: Flag,
        label: <Trans id="nav.goals">Goals</Trans>,
      },
    ],
  },
  {
    id: "income",
    icon: Coins,
    label: <Trans id="nav.incomeAndTax">Income & tax</Trans>,
    items: [
      {
        to: "/dividends",
        icon: CalendarDays,
        label: <Trans id="nav.dividends">Income</Trans>,
      },
      {
        to: "/income-tax",
        icon: Landmark,
        label: <Trans id="nav.incomeTax">Income tax</Trans>,
      },
    ],
  },
];

// Below `lg` the nav is a four-column tab bar (icon over label); from `lg`
// it becomes an inline row in the header.
const NAV_ITEM_CLASS =
  "flex min-w-0 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring lg:flex-row lg:gap-2 lg:px-3 lg:py-2 lg:text-sm";

function isActivePath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavGroupMenu({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const openedByPointer = useRef(false);
  const active = group.items.some((item) => isActivePath(pathname, item.to));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onPointerDown={() => {
            openedByPointer.current = true;
          }}
          onKeyDown={() => {
            openedByPointer.current = false;
          }}
          className={cn(
            NAV_ITEM_CLASS,
            (active || open) && "bg-accent text-accent-foreground",
          )}
        >
          <group.icon className="size-4" aria-hidden="true" />
          <span className="max-w-full truncate">{group.label}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "hidden size-3.5 transition-transform duration-200 motion-reduce:transition-none lg:block",
              open && "rotate-180",
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onKeyDown={() => {
          openedByPointer.current = false;
        }}
        // Radix returns focus to the trigger on close, which leaves a focus
        // ring behind after a mouse click; keyboard users still get it back.
        onCloseAutoFocus={(event) => {
          if (openedByPointer.current) {
            event.preventDefault();
          }
        }}
      >
        {group.items.map((item) => {
          const itemActive = isActivePath(pathname, item.to);

          return (
            <DropdownMenuItem
              key={item.to}
              asChild
              className={cn(itemActive && "bg-accent/60 font-medium")}
            >
              <Link to={item.to}>
                <item.icon
                  className={cn("size-4", itemActive && "text-primary")}
                  aria-hidden="true"
                />
                {item.label}
                {itemActive ? (
                  <Check className="ml-auto size-4" aria-hidden="true" />
                ) : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Header navigation. Allocation is the app's home and primary workflow, so it
 * stays a direct link ahead of the separator; everything else is grouped by
 * intent.
 */
export function AppNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const allocationActive = isActivePath(pathname, "/allocation");

  return (
    <>
      <Link
        to="/allocation"
        className={cn(
          NAV_ITEM_CLASS,
          allocationActive && "bg-accent text-accent-foreground",
        )}
      >
        <Target className="size-4" aria-hidden="true" />
        <span className="max-w-full truncate">
          <Trans id="nav.allocation">Allocation</Trans>
        </span>
      </Link>
      <span
        aria-hidden="true"
        className="mx-1 hidden h-5 w-px shrink-0 bg-border lg:block"
      />
      {NAV_GROUPS.map((group) => (
        <NavGroupMenu key={group.id} group={group} pathname={pathname} />
      ))}
    </>
  );
}
