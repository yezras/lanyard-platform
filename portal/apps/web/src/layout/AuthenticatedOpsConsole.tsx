import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";

import { OpsAuthView } from "../features/admin/OpsAuthView.js";
import { useOpsSession } from "../hooks/useOpsSession.js";
import { OpsConsole } from "./OpsConsole.js";

export function AuthenticatedOpsConsole() {
  const { state: session, setAuthenticated, refresh } = useOpsSession();

  if (session.status === "loading") {
    return (
      <Center minHeight="100dvh">
        <Spinner label="Loading operator session…" />
      </Center>
    );
  }

  if (session.status === "unauthenticated") {
    return <OpsAuthView onAuthenticated={setAuthenticated} />;
  }

  return <OpsConsole operator={session.operator} onLogout={refresh} />;
}
