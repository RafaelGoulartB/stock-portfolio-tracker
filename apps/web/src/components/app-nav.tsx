import { Trans } from "@lingui/react/macro";
import { Link, type LinkProps, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  Check,
  ChevronDown,
  type LucideIcon,
  PieChart,
  ScanSearch,
  TableProperties,
  Tags,
  Target,
  TrendingUp,
  Wrench,
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

/**
 * Header sections. Every page lives inside a group so the bar stays at a
 * handful of triggers as pages are added; empty groups are not rendered.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "portfolio",
    icon: PieChart,
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
        to: "/allocation",
        icon: Target,
        label: <Trans id="nav.allocation">Allocation</Trans>,
      },
    ],
  },
  {
    id: "results",
    icon: TrendingUp,
    label: <Trans id="nav.results">Results</Trans>,
    items: [
      {
        to: "/performance",
        icon: TrendingUp,
        label: <Trans id="nav.performance">Performance</Trans>,
      },
      {
        to: "/daily",
        icon: Activity,
        label: <Trans id="nav.daily">Daily</Trans>,
      },
      {
        to: "/deep-finder",
        icon: ScanSearch,
        label: <Trans id="nav.deepFinder">Deep Finder</Trans>,
      },
      {
        to: "/dividends",
        icon: CalendarDays,
        label: <Trans id="nav.dividends">Income</Trans>,
      },
    ],
  },
  {
    id: "tools",
    icon: Wrench,
    label: <Trans id="nav.tools">Tools</Trans>,
    items: [
      {
        to: "/categories",
        icon: Tags,
        label: <Trans id="nav.categories">My categories</Trans>,
      },
    ],
  },
];

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
            "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
            (active || open) && "bg-accent text-accent-foreground",
          )}
        >
          <group.icon className="size-4" aria-hidden="true" />
          {group.label}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
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
                <item.icon className="size-4" aria-hidden="true" />
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

/** Grouped section menus for the app header. */
export function AppNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <>
      {NAV_GROUPS.filter((group) => group.items.length > 0).map((group) => (
        <NavGroupMenu key={group.id} group={group} pathname={pathname} />
      ))}
    </>
  );
}
