import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-start gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">
        Portfolio Tracker
      </h1>
      <p className="text-muted-foreground">
        Track holdings, notes, and performance in the browser.
      </p>
      <Button type="button">Get started</Button>
    </main>
  );
}
