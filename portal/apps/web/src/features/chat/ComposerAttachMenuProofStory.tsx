/**
 * Auth-free proof story for composer + attach menu
 * (lp-khq.5 / lp-khq.6 / lp-khq.7 / lp-khq.12.3 / lp-khq.12.4).
 *
 * Mounted with `?story=composer-attach-menu`.
 * No live BFF required — fixture skills + vault tree drive the menu.
 *
 * Skills include one-line descriptions (and a name-only row) for lp-khq.6.
 * Vault tree enables progressive folder browse + path insert (lp-khq.7);
 * Open vault deep-link removed (lp-khq.12.4).
 * lp-khq.12.3: + lives in footerActions; Attach file is a root menu item.
 * Inserts always update controlled `value` so Send can enable and the value
 * panel reflects skill/vault text (Astryx insertToken/insertText do not
 * emitChange — do not use them as the sole insert path).
 */

import { useState, type CSSProperties } from "react";

import {
  ChatComposer,
  ChatComposerInput,
} from "@astryxdesign/core/Chat";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  ComposerAttachMenu,
  vaultFilesForAttachMenu,
  type AttachMenuSkill,
  type AttachMenuVaultTreeNode,
} from "./composerAttachMenu.js";

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  width: "100%",
  boxSizing: "border-box",
  padding: "24px",
  background: "var(--color-background-body, #fafafa)",
};

const composerWrapStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  marginTop: 16,
};

const FIXTURE_SKILLS: AttachMenuSkill[] = [
  {
    id: "summarize",
    name: "summarize",
    description: "Condense long documents into key points",
    enabled: true,
  },
  {
    id: "post-meeting-triage",
    name: "post-meeting-triage",
    description: "Extract actions and owners from meeting notes",
    enabled: true,
  },
  {
    id: "draft-reply",
    name: "draft-reply",
    description: "Draft a professional email reply",
    enabled: true,
  },
  // Name-only — empty description must not break skill row layout (lp-khq.6).
  {
    id: "plain-skill",
    name: "plain-skill",
    enabled: true,
  },
  {
    id: "long-desc",
    name: "long-desc",
    description:
      "This is a deliberately long one-line skill description used to verify graceful truncation in the skills picker without wrapping the entire menu",
    enabled: true,
  },
];

/** Nested vault tree for folder browse (lp-khq.7). */
const FIXTURE_VAULT_TREE: AttachMenuVaultTreeNode[] = [
  {
    name: "Business",
    path: "/Business",
    kind: "directory",
    children: [
      {
        name: "Contracts",
        path: "/Business/Contracts",
        kind: "directory",
        children: [
          {
            name: "MSA.docx",
            path: "/Business/Contracts/MSA.docx",
            kind: "file",
          },
        ],
      },
    ],
  },
  {
    name: "Projects",
    path: "/Projects",
    kind: "directory",
    children: [
      {
        name: "Alpha",
        path: "/Projects/Alpha",
        kind: "directory",
        children: [
          {
            name: "notes.md",
            path: "/Projects/Alpha/notes.md",
            kind: "file",
          },
        ],
      },
    ],
  },
  {
    name: "Knowledge",
    path: "/Knowledge",
    kind: "directory",
    children: [
      {
        name: "handbook.md",
        path: "/Knowledge/handbook.md",
        kind: "file",
      },
    ],
  },
];

const FIXTURE_VAULT_FILES = vaultFilesForAttachMenu(FIXTURE_VAULT_TREE);

/**
 * Offline harness: + attach menu with fixture inventory.
 * Last action + controlled value logged for Playwright assertions.
 */
export function ComposerAttachMenuProofStory() {
  const [value, setValue] = useState("");
  const [lastAction, setLastAction] = useState<string>("none");
  const [stubNotice, setStubNotice] = useState<string | null>(null);

  return (
    <div style={rootStyle} data-testid="composer-attach-menu-proof-story">
      <VStack gap={3}>
        <Heading level={1}>
          Composer + attach menu (lp-khq.5 / lp-khq.6 / lp-khq.7 / lp-khq.12.3 / lp-khq.12.4)
        </Heading>
        <Text color="secondary">
          Single + in the former paperclip footer slot. Attach file (local
          upload stub), skills (name + one-line description), and vault folder
          browse + path insert (no @ required). No Open vault deep-link —
          progressive folder → file only.
        </Text>

        <div
          style={composerWrapStyle}
          data-testid="composer-attach-menu-proof-composer"
        >
          <ChatComposer
            value={value}
            onChange={setValue}
            onSubmit={() => {
              setLastAction(`submit:${value}`);
            }}
            placeholder="Message your agent…"
            density="spacious"
            status={
              stubNotice
                ? { type: "warning", message: stubNotice }
                : undefined
            }
            footerActions={
              <ComposerAttachMenu
                skills={FIXTURE_SKILLS}
                vaultFiles={FIXTURE_VAULT_FILES}
                vaultTree={FIXTURE_VAULT_TREE}
                composerValue={value}
                onComposerChange={(next) => {
                  setValue(next);
                  // last_action is set in optional side-effect hooks below so
                  // skill/vault selections are distinguishable in artifacts.
                }}
                onAttachFile={() => {
                  setStubNotice("Attach file (opens local upload in app)");
                  setLastAction("attach:file");
                }}
                onInsertSkillToken={(skill) => {
                  setLastAction(`skill:${skill.name}`);
                }}
                onInsertVaultPath={(file) => {
                  setLastAction(`vault:${file.path}`);
                }}
              />
            }
            input={<ChatComposerInput />}
          />
        </div>

        <div
          data-testid="composer-attach-menu-last-action"
          data-action={lastAction}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            padding: "8px 12px",
            border: "1px dashed var(--color-border, #cbd5e1)",
            borderRadius: 8,
            background: "var(--color-background-surface, #fff)",
          }}
        >
          last_action={lastAction}
        </div>
        <div
          data-testid="composer-attach-menu-value"
          data-value={value}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            padding: "8px 12px",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: 8,
            background: "var(--color-background-surface, #fff)",
            minHeight: 32,
            wordBreak: "break-all",
          }}
        >
          {value || "(empty)"}
        </div>
      </VStack>
    </div>
  );
}
