/**
 * Composer + attach menu shell (lp-khq.5 / lp-khq.7 / lp-khq.12.3 / lp-khq.12.4).
 *
 * Primary discoverability for local file upload, skills, and vault paths.
 * Agents create workflows via tools; this menu does not (lp-v62i.2.1).
 * Keeps `/` typeahead as the power-user path.
 *
 * Placement: ChatComposer `footerActions` (former paperclip / Attach file slot).
 *
 * Nested panels (Skills / Vault): Astryx DropdownMenuItem closes the menu on
 * click, so drill-in re-opens the controlled menu on the next microtask.
 *
 * lp-khq.7: Select from vault browses folders when `vaultTree` is provided.
 * lp-khq.12.3: single + control replaces standalone paperclip; Attach file
 * (local upload) is a root menu item via `onAttachFile`.
 * lp-khq.12.4: no Open vault deep-link — progressive folder → file insert only;
 * empty vault shows an honest disabled empty state (no Vault tab CTA).
 * lp-xhf4.16: optional Connectors group starts in-chat OAuth / WhatsApp QR
 * pairing via `onConnectConnector`; rows render only when handler is present.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuItem,
} from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { PlusIcon } from "@heroicons/react/24/outline";

import {
  appendComposerFragment,
  oneLineDescription,
  skillInsertText,
  vaultBrowseLabel,
  vaultEntriesAtPath,
  vaultParentBrowsePath,
  vaultPathInsertText,
  vaultTreeHasContent,
  type AttachMenuPanel,
  type AttachMenuSkill,
  type AttachMenuVaultFile,
  type AttachMenuVaultTreeNode,
} from "./composerAttachMenuModel.js";

/** One Connectors group row (lp-xhf4.16). `disabled` renders a disabled item. */
export type ComposerConnectConnectorAction = {
  connectorId: "google" | "hubspot" | "whatsapp";
  label: string;
  disabled?: boolean;
};

/** Honest per-connector expectation line under the label (lp-xhf4.16). */
const CONNECTOR_ACTION_DESCRIPTIONS: Record<
  ComposerConnectConnectorAction["connectorId"],
  string
> = {
  google: "Sign-in opens in a new tab; this thread stays here.",
  hubspot: "Sign-in opens in a new tab; this thread stays here.",
  whatsapp: "Scan the QR code shown in this thread.",
};

export type ComposerAttachMenuProps = {
  skills: AttachMenuSkill[];
  /**
   * Flat vault file list (lp-khq.5). Used when `vaultTree` is omitted, and for
   * root-menu file counts when tree is empty of files but list is precomputed.
   */
  vaultFiles?: AttachMenuVaultFile[];
  /**
   * Vault tree roots for folder-browsing picker (lp-khq.7 preferred).
   * When non-empty, Select from vault navigates directories; files insert paths.
   */
  vaultTree?: AttachMenuVaultTreeNode[];
  /**
   * Current composer text used when building the next controlled value.
   * Prefer pairing with a functional `onComposerChange` updater in the host
   * when concurrent typing is possible; menu always writes controlled state.
   */
  composerValue: string;
  /**
   * Controlled composer text update — **required source of truth**.
   * Astryx `insertToken` / `insertText` do not emit `onChange`; Send and
   * re-renders depend on this value staying in sync.
   */
  onComposerChange: (next: string) => void;
  /**
   * Optional side-effect after skill text is applied (e.g. focus, analytics).
   * Must not be used as a substitute for `onComposerChange`.
   */
  onInsertSkillToken?: (skill: AttachMenuSkill) => void;
  /**
   * Optional side-effect after vault path text is applied.
   * Must not be used as a substitute for `onComposerChange`.
   */
  onInsertVaultPath?: (file: AttachMenuVaultFile) => void;
  /**
   * Trigger local file upload (lp-khq.12.3). Host owns the hidden file input
   * and staging upload; menu only invokes this when user picks Attach file.
   */
  onAttachFile?: () => void;
  /**
   * Connectors group rows (lp-xhf4.16). Rendered only when this is non-empty
   * AND `onConnectConnector` is provided — no handler, no group.
   */
  connectorActions?: ComposerConnectConnectorAction[];
  /** Start in-chat OAuth / WhatsApp QR pairing for a connector (lp-xhf4.16). */
  onConnectConnector?: (
    connectorId: ComposerConnectConnectorAction["connectorId"],
  ) => void;
  isDisabled?: boolean;
};

export function ComposerAttachMenu({
  skills,
  vaultFiles = [],
  vaultTree,
  composerValue,
  onComposerChange,
  onInsertSkillToken,
  onInsertVaultPath,
  onAttachFile,
  connectorActions = [],
  onConnectConnector,
  isDisabled = false,
}: ComposerAttachMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panel, setPanel] = useState<AttachMenuPanel>("root");
  /** Current folder in tree browse mode (`""` = vault roots). */
  const [vaultBrowsePath, setVaultBrowsePath] = useState("");
  /** When true, onOpenChange(false) from item click must not reset panel. */
  const drillInRef = useRef(false);

  const treeMode = vaultTreeHasContent(vaultTree);
  const flatFiles = vaultFiles;
  const fileCount = treeMode
    ? // Prefer explicit flat count when host provides it; else rough tree size.
      flatFiles.length > 0
      ? flatFiles.length
      : countTreeFiles(vaultTree!)
    : flatFiles.length;
  const vaultEmpty = treeMode ? false : flatFiles.length === 0;

  const closeAndReset = useCallback(() => {
    drillInRef.current = false;
    setIsOpen(false);
    setPanel("root");
    setVaultBrowsePath("");
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && drillInRef.current) {
      // Item click closed the menu while drilling into a nested panel —
      // re-open immediately on the new panel.
      drillInRef.current = false;
      setIsOpen(true);
      return;
    }
    setIsOpen(open);
    if (!open) {
      setPanel("root");
      setVaultBrowsePath("");
    }
  }, []);

  const goToPanel = useCallback((next: AttachMenuPanel) => {
    drillInRef.current = true;
    if (next === "vault") {
      setVaultBrowsePath("");
    }
    setPanel(next);
  }, []);

  const insertSkill = useCallback(
    (skill: AttachMenuSkill) => {
      // Always update controlled value so Send enables and re-renders keep text.
      // (Astryx imperative insertToken does not emit onChange — do not rely on it.)
      const next = appendComposerFragment(
        composerValue,
        skillInsertText(skill),
      );
      onComposerChange(next);
      onInsertSkillToken?.(skill);
      closeAndReset();
    },
    [closeAndReset, composerValue, onComposerChange, onInsertSkillToken],
  );

  const insertVault = useCallback(
    (file: AttachMenuVaultFile) => {
      const next = appendComposerFragment(
        composerValue,
        vaultPathInsertText(file),
      );
      onComposerChange(next);
      onInsertVaultPath?.(file);
      closeAndReset();
    },
    [closeAndReset, composerValue, onComposerChange, onInsertVaultPath],
  );

  const enterVaultFolder = useCallback((dirPath: string) => {
    drillInRef.current = true;
    setVaultBrowsePath(dirPath);
  }, []);

  const vaultBack = useCallback(() => {
    drillInRef.current = true;
    const parent = vaultParentBrowsePath(vaultBrowsePath);
    if (parent === null) {
      setPanel("root");
      setVaultBrowsePath("");
      return;
    }
    setVaultBrowsePath(parent);
  }, [vaultBrowsePath]);

  const skillEmpty = skills.length === 0;

  const treeEntries = useMemo(() => {
    if (!treeMode || !vaultTree) return [];
    return vaultEntriesAtPath(vaultTree, vaultBrowsePath);
  }, [treeMode, vaultBrowsePath, vaultTree]);

  const rootItems = useMemo(
    () => (
      <>
        {onAttachFile ? (
          <DropdownMenuItem
            label="Attach file"
            description="Upload a local file"
            onClick={() => {
              onAttachFile();
              closeAndReset();
            }}
          />
        ) : null}
        <DropdownMenuItem
          label="Skills"
          description={
            skillEmpty
              ? "No skills available"
              : `${skills.length} skill${skills.length === 1 ? "" : "s"}`
          }
          isDisabled={skillEmpty}
          onClick={() => {
            if (!skillEmpty) goToPanel("skills");
          }}
        />
        <DropdownMenuItem
          label="Select from vault"
          description={
            vaultEmpty
              ? "No vault files loaded"
              : treeMode
                ? "Browse folders and files"
                : `${fileCount} file${fileCount === 1 ? "" : "s"}`
          }
          isDisabled={vaultEmpty}
          onClick={() => {
            if (!vaultEmpty) goToPanel("vault");
          }}
        />
        {onConnectConnector && connectorActions.length > 0 ? (
          // lp-xhf4.16: Connectors group — in-chat OAuth / QR pairing.
          // display:contents keeps Astryx menu layout untouched by the
          // per-item data-testid wrapper spans.
          connectorActions.map((action) => (
            <span
              key={action.connectorId}
              data-testid={`connector-connect-${action.connectorId}`}
              style={{ display: "contents" }}
            >
              <DropdownMenuItem
                label={action.label}
                description={CONNECTOR_ACTION_DESCRIPTIONS[action.connectorId]}
                isDisabled={action.disabled}
                onClick={() => {
                  onConnectConnector(action.connectorId);
                  closeAndReset();
                }}
              />
            </span>
          ))
        ) : null}
      </>
    ),
    [
      closeAndReset,
      connectorActions,
      fileCount,
      goToPanel,
      onAttachFile,
      onConnectConnector,
      skillEmpty,
      skills.length,
      treeMode,
      vaultEmpty,
    ],
  );

  const skillsPanel = useMemo(
    () => (
      <>
        <DropdownMenuItem
          label="← Back"
          description="Attach menu"
          onClick={() => goToPanel("root")}
        />
        {skills.map((skill) => {
          // One-line only; omit when empty so name-only rows stay compact (lp-khq.6).
          const description = oneLineDescription(skill.description);
          return (
            <DropdownMenuItem
              key={skill.id}
              label={skill.name}
              description={description}
              onClick={() => insertSkill(skill)}
            />
          );
        })}
        {skillEmpty ? (
          <DropdownMenuItem
            label="No skills"
            description="Enable skills in Tools"
            isDisabled
          />
        ) : null}
      </>
    ),
    [goToPanel, insertSkill, skillEmpty, skills],
  );

  const vaultPanel = useMemo(() => {
    const browseLabel = vaultBrowseLabel(vaultBrowsePath);
    const atRoot = vaultBrowsePath === "";

    if (treeMode) {
      const emptyHere = treeEntries.length === 0;
      return (
        <>
          <DropdownMenuItem
            label="← Back"
            description={atRoot ? "Attach menu" : browseLabel}
            onClick={vaultBack}
          />
          {treeEntries.map((node) =>
            node.kind === "directory" ? (
              <DropdownMenuItem
                key={`dir:${node.path}`}
                label={`${node.name}/`}
                description="Folder"
                onClick={() => enterVaultFolder(node.path)}
              />
            ) : (
              <DropdownMenuItem
                key={`file:${node.path}`}
                label={node.name}
                description={node.path}
                onClick={() =>
                  insertVault({ path: node.path, name: node.name })
                }
              />
            ),
          )}
          {emptyHere ? (
            <DropdownMenuItem
              label="Empty folder"
              description="No files here"
              isDisabled
            />
          ) : null}
        </>
      );
    }

    // Flat fallback (lp-khq.5 shell / stories without tree).
    return (
      <>
        <DropdownMenuItem
          label="← Back"
          description="Attach menu"
          onClick={() => goToPanel("root")}
        />
        {flatFiles.map((file) => (
          <DropdownMenuItem
            key={file.path}
            label={file.name}
            description={file.path}
            onClick={() => insertVault(file)}
          />
        ))}
        {vaultEmpty ? (
          <DropdownMenuItem
            label="No files"
            description="Vault tree empty or unavailable"
            isDisabled
          />
        ) : null}
      </>
    );
  }, [
    enterVaultFolder,
    flatFiles,
    goToPanel,
    insertVault,
    treeEntries,
    treeMode,
    vaultBack,
    vaultBrowsePath,
    vaultEmpty,
  ]);

  const panelBody =
    panel === "skills" ? skillsPanel : panel === "vault" ? vaultPanel : rootItems;

  return (
    <span
      data-testid="composer-attach-menu"
      data-panel={panel}
      data-open={isOpen ? "true" : "false"}
      data-skill-count={skills.length}
      data-vault-count={fileCount}
      data-vault-mode={treeMode ? "tree" : "flat"}
      data-vault-browse-path={vaultBrowsePath || "/"}
    >
      <DropdownMenu
        isMenuOpen={isOpen}
        onOpenChange={handleOpenChange}
        // Slightly wider so skill one-line descriptions can breathe before ellipsis.
        menuWidth={panel === "skills" || panel === "vault" ? 320 : 280}
        placement="above"
        data-testid="composer-attach-menu-dropdown"
        button={{
          // Accessible name for the + trigger (Astryx uses label as aria-label).
          label: "Attach to message",
          tooltip: "Attach file, skill, vault path, or workflow",
          variant: "ghost",
          size: "sm",
          isIconOnly: true,
          isDisabled,
          icon: <Icon icon={PlusIcon} size="sm" />,
        }}
      >
        {panelBody}
      </DropdownMenu>
    </span>
  );
}

function countTreeFiles(roots: readonly AttachMenuVaultTreeNode[]): number {
  let n = 0;
  const walk = (list: readonly AttachMenuVaultTreeNode[]) => {
    for (const node of list) {
      if (node.kind === "file") n += 1;
      else if (node.children?.length) walk(node.children);
    }
  };
  walk(roots);
  return n;
}

/** Re-export pure helpers for tests and ChatView wiring. */
export {
  appendComposerFragment,
  attachableSkillsFromSnapshot,
  findVaultTreeNode,
  oneLineDescription,
  skillInsertText,
  skillInsertToken,
  vaultBrowseLabel,
  vaultEntriesAtPath,
  vaultFilesForAttachMenu,
  vaultParentBrowsePath,
  vaultPathInsertText,
  vaultTreeHasContent,
  type AttachMenuPanel,
  type AttachMenuSkill,
  type AttachMenuVaultFile,
  type AttachMenuVaultTreeNode,
} from "./composerAttachMenuModel.js";
