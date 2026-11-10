import { useState, type CSSProperties } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";

import { apiFetch, resetCsrfToken } from "../../api/client.js";
import { withApiBase } from "../../api/tenantBase.js";
import type { AuthUser } from "../../api/types.js";
import { useAuthOptions } from "../../hooks/useAuthOptions.js";
import { DEV_GOOGLE_STUB } from "./constants.js";

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={16}
    height={16}
    aria-hidden="true"
    {...props}
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  backgroundColor: "var(--color-background-body)",
  padding: "var(--spacing-6)",
  boxSizing: "border-box",
};

const contentStyle: CSSProperties = {
  width: "100%",
  maxWidth: 400,
};

function LanyardLogo() {
  return (
    <img
      src="/brand/Lanyard_Icon_blue.svg"
      alt="Lanyard"
      width={40}
      height={40}
    />
  );
}

type AuthViewProps = {
  onAuthenticated: (user: AuthUser) => void;
};

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const signInOptions = useAuthOptions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function handleEmailLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("");
    setFieldError(undefined);
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? `Sign in failed (${res.status})`;
        setFieldError(message);
        setStatusMessage(message);
        return;
      }

      const user = (await res.json()) as AuthUser;
      resetCsrfToken();
      onAuthenticated(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      setFieldError(message);
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleDevStub() {
    setStatusMessage("");
    setFieldError(undefined);
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/auth/google/stub", {
        method: "POST",
        body: JSON.stringify(DEV_GOOGLE_STUB),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? `Google stub sign-in failed (${res.status})`;
        setStatusMessage(message);
        return;
      }

      const user = (await res.json()) as AuthUser;
      resetCsrfToken();
      onAuthenticated(user);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google stub sign-in failed";
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const showGoogleDivider =
    signInOptions.status === "ready" &&
    (signInOptions.googleSignIn || signInOptions.googleDevStub);

  return (
    <Center axis="both" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <LanyardLogo />

        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2}>Sign in</Heading>
            </VStack>

            <form onSubmit={(event) => void handleEmailLogin(event)}>
              <VStack gap={4}>
                <VStack gap={2}>
                  <TextInput
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@example.com"
                    htmlName="email"
                    isDisabled={isSubmitting}
                    autoComplete="email"
                    size="lg"
                  />
                  <TextInput
                    label="Password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    htmlName="password"
                    isDisabled={isSubmitting}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    size="lg"
                    status={
                      fieldError
                        ? { type: "error", message: fieldError }
                        : undefined
                    }
                  />
                </VStack>

                <Button
                  type="submit"
                  label="Log in"
                  variant="primary"
                  size="lg"
                  isLoading={isSubmitting}
                />
              </VStack>
            </form>

            {signInOptions.status === "loading" ? (
              <Spinner label="Loading sign-in options…" />
            ) : null}

            {showGoogleDivider ? (
              <VStack gap={4}>
                <Divider label="Or continue with" />
                <VStack gap={3} hAlign="stretch">
                  {signInOptions.googleSignIn ? (
                    <Button
                      type="button"
                      label="Sign in with Google"
                      variant="secondary"
                      icon={<GoogleIcon />}
                      size="lg"
                      isDisabled={isSubmitting}
                      onClick={() => {
                        window.location.assign(withApiBase("/api/auth/google"));
                      }}
                    />
                  ) : null}
                  {signInOptions.googleDevStub ? (
                    <Button
                      type="button"
                      label="Sign in with Google"
                      variant="secondary"
                      icon={<GoogleIcon />}
                      size="lg"
                      isLoading={isSubmitting}
                      clickAction={handleGoogleDevStub}
                    />
                  ) : null}
                </VStack>
              </VStack>
            ) : null}

            {statusMessage && !fieldError ? (
              <Text type="body" color="secondary">
                {statusMessage}
              </Text>
            ) : null}
          </VStack>
        </Card>
      </VStack>
    </Center>
  );
}