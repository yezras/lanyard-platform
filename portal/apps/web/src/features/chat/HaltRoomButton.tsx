/**
 * Halt control (lp-v62i.2.3 / lp-v62i.3.7).
 *
 * Not mounted on the agent chat header (lp-bhcg.23). The mailbox halt HTTP
 * route stays; this button must not render on the agents chat page.
 * Do not call cancel from here — ChatSendButton isStopShown owns Stop.
 * Product copy is Halt, not Stop or Resume.
 */

import { Button } from "@astryxdesign/core/Button";

export type HaltRoomButtonProps = {
  onHalt?: () => void;
  isDisabled?: boolean;
};

export function HaltRoomButton({
  onHalt,
  isDisabled = false,
}: HaltRoomButtonProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        flexShrink: 0,
        padding: "0 16px 8px",
        minWidth: 0,
      }}
    >
      <Button
        type="button"
        label="Halt"
        size="sm"
        variant="secondary"
        isDisabled={isDisabled}
        onClick={onHalt}
        data-testid="mailbox-halt"
      />
    </div>
  );
}
