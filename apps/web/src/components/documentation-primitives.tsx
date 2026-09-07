import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function DocumentBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-3xl gap-8">{children}</div>;
}

export function Topic({
  title,
  children,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function Callout({
  icon: Icon,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/35 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 gap-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <div className="text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function Definition({
  term,
  children,
}: {
  term: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border px-3.5 py-3">
      <p className="font-medium text-foreground">{term}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </code>
  );
}

export function Rule({
  number,
  title,
  children,
  badge,
}: {
  number: string;
  title: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-lg border px-3.5 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{title}</p>
          {badge}
        </div>
        <div className="mt-1 grid gap-2 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
