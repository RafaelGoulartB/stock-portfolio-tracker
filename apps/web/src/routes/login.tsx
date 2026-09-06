import { zodResolver } from "@hookform/resolvers/zod";
import { credentialsSchema } from "@portifolio-tracker/shared";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { LineChart, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/api";
import { sessionQueryOptions, setSession } from "@/lib/session";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (user) {
      throw redirect({ to: "/positions" });
    }
  },
  component: LoginPage,
});

type Mode = "login" | "register";
type FormValues = z.input<typeof credentialsSchema>;

const COPY: Record<Mode, { title: string; description: string; cta: string }> =
  {
    login: {
      title: "Sign in",
      description: "Use your email and password to open your portfolio.",
      cta: "Sign in",
    },
    register: {
      title: "Create account",
      description: "Set up an account to start tracking your trades.",
      cta: "Create account",
    },
  };

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onAuthenticated(user: { id: string; email: string }) {
    setSession(user);
    await navigate({ to: "/positions" });
  }

  const login = trpc.auth.login.useMutation({
    onSuccess: onAuthenticated,
    onError: (mutationError) => setError(mutationError.message),
  });

  const register = trpc.auth.register.useMutation({
    onSuccess: onAuthenticated,
    onError: (mutationError) => setError(mutationError.message),
  });

  const active = mode === "login" ? login : register;
  const copy = COPY[mode];

  function switchMode() {
    setMode((current) => (current === "login" ? "register" : "login"));
    setError(null);
    form.clearErrors();
  }

  function onSubmit(values: FormValues) {
    setError(null);
    active.mutate(values);
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <LineChart className="size-6" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight">
            Portfolio Tracker
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete={
                            mode === "login"
                              ? "current-password"
                              : "new-password"
                          }
                          placeholder="At least 8 characters"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={active.isPending}
                >
                  {active.isPending ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {copy.cta}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "login"
            ? "Don't have an account yet?"
            : "Already have an account?"}{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={switchMode}
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </Button>
        </p>
      </div>
    </main>
  );
}
