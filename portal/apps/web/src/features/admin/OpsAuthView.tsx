import { useEffect, useState, type CSSProperties } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";

import {
  isLocalOpsFrontend,
  opsGoogleStartUrl,
  stubOpsGoogleLogin,
  type OpsOperator,
} from "../../api/opsAuth.js";
import { isGoogleSignInAvailable } from "../../hooks/authSignInOptions.js";

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

type OpsAuthViewProps = {
  onAuthenticated: (operator: OpsOperator) => void;
};

export function OpsAuthView({ onAuthenticated }: OpsAuthViewProps) {
  const [googleSignIn, setGoogleSignIn] = useState(false);
  const [optionsReady, setOptionsReady] = useState(false);
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const localStub = isLocalOpsFrontend(window.location.hostname) && !googleSignIn;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let googleStatus = 503;
      let googleResponseType: string | undefined;
      try {
        const googleRes = await fetch(opsGoogleStartUrl(), {
          redirect: "manual",
          credentials: "include",
        });
        googleStatus = googleRes.status;
        googleResponseType = googleRes.type;
      } catch {
        googleStatus = 503;
      }
      if (!cancelled) {
        setGoogleSignIn(
          isGoogleSignInAvailable({ googleStatus, googleResponseType }),
        );
        setOptionsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLocalStub(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("");
    setIsSubmitting(true);
    try {
      const operator = await stubOpsGoogleLogin(email);
      onAuthenticated(operator);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Sign in failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Center axis="both" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <LanyardLogo />
        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2}>Platform admin</Heading>
              <Text type="body" color="secondary">
                Operator sign-in. Tenant Portal sessions cannot open this console.
              </Text>
            </VStack>

            {!optionsReady ? <Spinner label="Loading sign-in options…" /> : null}

            {googleSignIn ? (
              <Button
                type="button"
                label="Sign in with Google"
                variant="primary"
                icon={<GoogleIcon />}
                size="lg"
                isDisabled={isSubmitting}
                onClick={() => {
                  window.location.assign(opsGoogleStartUrl());
                }}
              />
            ) : null}

            {optionsReady && localStub ? (
              <form onSubmit={(event) => void handleLocalStub(event)}>
                <VStack gap={4}>
                  <TextInput
                    label="Allowlisted operator email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="dev@demo.local"
                    htmlName="email"
                    isDisabled={isSubmitting}
                    autoComplete="email"
                    size="lg"
                  />
                  <Button
                    type="submit"
                    label="Sign in (local stub)"
                    variant="secondary"
                    size="lg"
                    isLoading={isSubmitting}
                  />
                </VStack>
              </form>
            ) : null}

            {optionsReady && !googleSignIn && !localStub ? (
              <Text type="body" color="secondary">
                Google sign-in is not configured for this environment.
              </Text>
            ) : null}

            {statusMessage ? (
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
