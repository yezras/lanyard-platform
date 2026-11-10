import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";

import { AuthView } from "../features/auth/AuthView.js";
import { useSession } from "../hooks/useSession.js";
import { PortalShell } from "../layout/PortalShell.js";

export function App() {
  const { state: session, setAuthenticated, refresh } = useSession();

  if (session.status === "loading") {
    return (
      <Center minHeight="100dvh">
        <Spinner label="Loading session…" />
      </Center>
    );
  }

  if (session.status === "unauthenticated") {
    return <AuthView onAuthenticated={setAuthenticated} />;
  }

  return <PortalShell user={session.user} onLogout={refresh} />;
}