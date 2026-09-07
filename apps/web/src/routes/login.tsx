import { zodResolver } from "@hookform/resolvers/zod";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { credentialsSchema } from "@portifolio-tracker/shared";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { LineChart, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { LogoDevAttribution } from "@/components/asset-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
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
import { authErrorMessage } from "@/lib/trpcErrors";

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

function LoginPage() {
  const { i18n } = useLingui();
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
    onError: (mutationError) =>
      setError(authErrorMessage(mutationError, "login")),
  });

  const register = trpc.auth.register.useMutation({
    onSuccess: onAuthenticated,
    onError: (mutationError) =>
      setError(authErrorMessage(mutationError, "register")),
  });

  const active = mode === "login" ? login : register;

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
            <Trans id="shell.brand">Portfolio Tracker</Trans>
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {mode === "login" ? (
                <Trans id="login.title">Sign in</Trans>
              ) : (
                <Trans id="register.title">Create account</Trans>
              )}
            </CardTitle>
            <CardDescription>
              {mode === "login" ? (
                <Trans id="login.description">
                  Use your email and password to open your portfolio.
                </Trans>
              ) : (
                <Trans id="register.description">
                  Set up an account to start tracking your trades.
                </Trans>
              )}
            </CardDescription>
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
                      <FormLabel>
                        <Trans id="login.email">Email</Trans>
                      </FormLabel>
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
                      <FormLabel>
                        <Trans id="login.password">Password</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete={
                            mode === "login"
                              ? "current-password"
                              : "new-password"
                          }
                          placeholder={i18n._(
                            msg({
                              id: "login.passwordHint",
                              message: "At least 8 characters",
                            }),
                          )}
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
                  {mode === "login" ? (
                    <Trans id="login.cta">Sign in</Trans>
                  ) : (
                    <Trans id="register.cta">Create account</Trans>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <Trans id="login.noAccount">Don&apos;t have an account yet?</Trans>
          ) : (
            <Trans id="login.hasAccount">Already have an account?</Trans>
          )}{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={switchMode}
          >
            {mode === "login" ? (
              <Trans id="login.switchToRegister">Create one</Trans>
            ) : (
              <Trans id="login.switchToLogin">Sign in</Trans>
            )}
          </Button>
        </p>

        <div className="flex items-center justify-center gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

        <LogoDevAttribution className="text-center" />
      </div>
    </main>
  );
}
