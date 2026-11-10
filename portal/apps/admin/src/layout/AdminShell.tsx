import type { ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";

function LanyardLogo() {
  return (
    <img
      src="/brand/Lanyard_Icon_blue.svg"
      alt=""
      width={28}
      height={28}
      aria-hidden="true"
    />
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: "100dvh" }}>
      <AppShell
        contentPadding={4}
        topNav={
          <TopNav
            label="Lanyard Admin"
            heading={
              <TopNavHeading logo={<LanyardLogo />} heading="Lanyard Admin" />
            }
          />
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
