import { Banner } from "@astryxdesign/core/Banner";

import type { HonestyNotice } from "./honestyCopy.js";

export type HonestyBannerProps = {
  notice: HonestyNotice | null;
  /** Optional dismiss; when omitted the banner is non-dismissable (operator should see it). */
  onDismiss?: () => void;
};

/**
 * Inline operator honesty banner for Settings / Vault / Directory.
 * Renders nothing when notice is null.
 */
export function HonestyBanner({ notice, onDismiss }: HonestyBannerProps) {
  if (!notice) {
    return null;
  }

  return (
    <div
      data-testid={`honesty-banner-${notice.id}`}
      data-honesty-id={notice.id}
      style={{ minWidth: 0, width: "100%" }}
    >
      <Banner
        status={notice.status}
        title={notice.title}
        description={notice.description}
        container="section"
        isDismissable={Boolean(onDismiss)}
        onDismiss={onDismiss}
      />
    </div>
  );
}
