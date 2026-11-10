/**
 * Inline document reopen chips (lp-a8u.2).
 *
 * Citation-parity Token + file-type icon. Click reopens the vault path in
 * the chat document pane (preview-first; Edit remains the existing flow).
 */

import type { MouseEvent } from "react";

import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";

import { fileTypeIcon } from "../../vault/fileTypeIcon.js";
import { citationDisplayTitle } from "../../vault/vaultPaths.js";

import type { DocumentReopenChip } from "./documentReopenChips.js";

export type DocumentReopenChipBarProps = {
  chips: readonly DocumentReopenChip[];
  onOpen: (path: string) => void;
  /** Hermes project cwd — display title relative when possible. */
  projectVaultPath?: string | null;
};

function chipLabel(
  chip: DocumentReopenChip,
  projectVaultPath?: string | null,
): string {
  return citationDisplayTitle(chip.path, projectVaultPath, chip.title);
}

/**
 * Sticky timeline strip of reopen chips for docs opened in this thread.
 * Hidden when empty.
 */
export function DocumentReopenChipBar({
  chips,
  onOpen,
  projectVaultPath,
}: DocumentReopenChipBarProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <VStack
      gap={1}
      data-testid="document-reopen-chip-bar"
      className="chat-document-reopen-chip-bar"
    >
      <Text type="supporting" color="secondary">
        Opened documents
      </Text>
      <HStack gap={1} wrap="wrap">
        {chips.map((chip, index) => {
          const label = chipLabel(chip, projectVaultPath);
          return (
            <Token
              key={chip.path}
              size="sm"
              label={label}
              description={`Reopen ${label}`}
              icon={<Icon icon={fileTypeIcon(chip.path)} size="xsm" />}
              onClick={(event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                onOpen(chip.path);
              }}
              data-testid={`document-reopen-chip-${index + 1}`}
            />
          );
        })}
      </HStack>
    </VStack>
  );
}
