import { createElement, type ReactNode } from "react";

import type {
  ChatComposerToken,
  ChatComposerTrigger,
} from "@astryxdesign/core/Chat";
import {
  createStaticSource,
  TypeaheadItem,
  type SearchableItem,
} from "@astryxdesign/core/Typeahead";

import { oneLineDescription } from "./composerAttachMenuModel.js";
import { DitherAvatar } from "./DitherAvatar.js";

/** Minimal static hashtags when project tags are unavailable (product-local). */
export const DEFAULT_CHAT_TAGS: SearchableItem[] = [
  { id: "todo", label: "todo" },
  { id: "important", label: "important" },
  { id: "follow-up", label: "follow-up" },
  { id: "reference", label: "reference" },
];

/** Auxiliary payload for skill typeahead rows (lp-khq.6). */
export type SkillSearchAux = {
  description?: string;
};

/** Auxiliary payload for @ mention rows (lp-8sh4.4 / lp-v62i.27). */
export type MentionSearchAux = {
  mention?: boolean;
  roomAddress?: boolean;
  description?: string;
};

/** Read the mention flag from a typeahead item when present. */
export function isMentionItem(item: SearchableItem): boolean {
  const aux = item.auxiliaryData as MentionSearchAux | undefined;
  return aux?.mention === true;
}

/** Read one-line skill description from a typeahead item when present. */
export function skillDescriptionFromItem(
  item: SearchableItem,
): string | undefined {
  const aux = item.auxiliaryData as SkillSearchAux | undefined;
  return oneLineDescription(aux?.description);
}

/**
 * Default skill row for `/` typeahead — label + optional one-line description.
 * Uses Astryx TypeaheadItem so secondary text truncates with ellipsis.
 */
export function renderSkillTypeaheadItem(item: SearchableItem): ReactNode {
  return createElement(TypeaheadItem, {
    item,
    description: skillDescriptionFromItem(item),
  });
}

/**
 * @ mention row (lp-8sh4.4): display name + dither avatar seeded by id —
 * never a raw UUID. Non-mention rows render plain (no vault @ rows).
 */
export function renderMentionTypeaheadItem(item: SearchableItem): ReactNode {
  const aux = item.auxiliaryData as MentionSearchAux | undefined;
  const description = oneLineDescription(aux?.description);
  return createElement(
    TypeaheadItem,
    {
      item,
      ...(description ? { description } : {}),
      ...(isMentionItem(item) && !aux?.roomAddress
        ? {
            icon: createElement(DitherAvatar, {
              seed: item.id,
              size: 16,
              label: item.label,
            }),
          }
        : {}),
    },
  );
}

/**
 * Host / product sources for composer typeahead menus.
 * Skills are **host inventory only** (grill Q4 / lp-rt5.6).
 * Empty or omitted lists mean the corresponding trigger is omitted — no fake
 * `summarize` skill fallback and no `researcher`/`writer` agent stubs.
 *
 * Tags remain product-local defaults when omitted.
 * Workflows: only surface when the host advertises a non-empty list (no Portal
 * workflow runner is invented when inventory is empty).
 */
export type ComposerTriggerSources = {
  /** Enabled host skills (e.g. from settings.snapshot). */
  skills?: SearchableItem[];
  /**
   * Ignored for `@` typeahead (lp-v62i.2.2). Callers may still pass vault
   * context items; plus/attach owns file and vault insertion.
   */
  contexts?: SearchableItem[];
  /**
   * Group-room roster. When non-empty, `@` completes the room.
   * When empty, `@` is omitted — no vault-path fallback, no agent stubs.
   */
  roster?: SearchableItem[];
  /** Product-local tags; falls back to DEFAULT_CHAT_TAGS when omitted/empty. */
  tags?: SearchableItem[];
  /**
   * Host-advertised workflows. Non-empty only — no invented workflow UI.
   * Character is `$` (pass-through token `$workflow-id` for the host).
   */
  workflows?: SearchableItem[];
};

/**
 * Build composer triggers from live inventory.
 *
 * - `/` — host skills only (omit when empty)
 * - `@` — room roster only (omit when empty; no vault-path fallback; no
 *   DEFAULT_AGENT_STUBS)
 * - `#` — tags (product-local defaults allowed)
 * - `$` — host workflows only when advertised (omit when empty)
 */
export function buildComposerTriggers(
  sources: ComposerTriggerSources = {},
): ChatComposerTrigger[] {
  const skills = sources.skills ?? [];
  const roster = sources.roster ?? [];
  const tags = sources.tags?.length ? sources.tags : DEFAULT_CHAT_TAGS;
  const workflows = sources.workflows ?? [];

  const triggers: ChatComposerTrigger[] = [];

  if (skills.length > 0) {
    triggers.push({
      character: "/",
      searchSource: createStaticSource(skills, {
        // Allow filtering by one-line description as well as name.
        keywords: (item) => {
          const description = skillDescriptionFromItem(item);
          return description ? [description] : [];
        },
      }),
      menuLabel: "Skills",
      // Show name + description in / typeahead when host provides it (lp-khq.6).
      renderItem: renderSkillTypeaheadItem,
      onSelect: (item) => ({
        value: `/${item.label}`,
        label: `/${item.label}`,
        variant: "yellow" as const,
      }),
    });
  }

  if (roster.length > 0) {
    triggers.push({
      character: "@",
      searchSource: createStaticSource(roster),
      menuLabel: "Room",
      renderItem: renderMentionTypeaheadItem,
      onSelect: (item) => {
        // lp-8sh4.4: roster mentions insert the display name (BFF resolves
        // display names).
        const value = isMentionItem(item) ? item.label : item.id;
        return {
          value: `@${value}`,
          label: item.label.startsWith("@") ? item.label : `@${item.label}`,
          variant: "blue" as const,
        };
      },
    });
  }

  triggers.push({
    character: "#",
    searchSource: createStaticSource(tags),
    menuLabel: "Tags",
    onSelect: (item) => ({
      value: `#${item.id}`,
      label: `#${item.label}`,
      variant: "purple" as const,
    }),
  });

  if (workflows.length > 0) {
    triggers.push({
      character: "$",
      searchSource: createStaticSource(workflows),
      menuLabel: "Workflows",
      onSelect: (item) => ({
        value: `$${item.id}`,
        label: item.label.startsWith("$") ? item.label : `$${item.label}`,
        variant: "green" as const,
      }),
    });
  }

  return triggers;
}

/**
 * Token defs for ChatTokenizedText from a plain message string.
 * Matches serialized values produced by buildComposerTriggers onSelect.
 *
 * Slash tokens prefer **path-shaped** spans: consecutive `/segment` pieces
 * (including dots/extensions) become one yellow chip so vault paths like
 * `/Business/Contracts/MSA.docx` are not split into N skill chips. Isolated
 * skills such as `/summarize` remain single-segment matches.
 */
export function tokensFromMessageContent(content: string): ChatComposerToken[] {
  const tokens: ChatComposerToken[] = [];
  const seen = new Set<string>();

  const patterns: Array<{
    re: RegExp;
    variant: "yellow" | "blue" | "purple" | "green";
  }> = [
    // One continuous slash path: /skill OR /dir/file.ext (not per-segment).
    // Segment body allows word chars, dots, and hyphens (vault file names).
    { re: /\/[\w][\w.-]*(?:\/[\w][\w.-]*)*/g, variant: "yellow" },
    // lp-8sh4.4: @ display-name mentions may span capitalized/digit words
    // ("@Taste A 1787593336"); lowercase continuation words stay plain text.
    { re: /@[\w][\w./-]*(?: [A-Z0-9][\w./-]*)*/g, variant: "blue" },
    { re: /#[\w][\w-]*/g, variant: "purple" },
    { re: /\$[\w][\w-]*/g, variant: "green" },
  ];

  for (const { re, variant } of patterns) {
    for (const match of content.matchAll(re)) {
      const value = match[0];
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      tokens.push({ value, label: value, variant });
    }
  }

  return tokens;
}

/** Flatten vault tree file paths into typeahead items (path id + filename label). */
export function vaultPathsToSearchItems(
  nodes: Array<{
    name: string;
    path: string;
    kind: "file" | "directory";
    children?: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      children?: unknown[];
    }>;
  }>,
  limit = 50,
): SearchableItem[] {
  const items: SearchableItem[] = [];

  const walk = (
    list: Array<{
      name: string;
      path: string;
      kind: "file" | "directory";
      children?: Array<{
        name: string;
        path: string;
        kind: "file" | "directory";
        children?: unknown[];
      }>;
    }>,
  ) => {
    for (const node of list) {
      if (items.length >= limit) {
        return;
      }
      if (node.kind === "file") {
        items.push({
          id: node.path,
          label: node.name,
        });
      } else if (node.children?.length) {
        walk(
          node.children as Array<{
            name: string;
            path: string;
            kind: "file" | "directory";
            children?: Array<{
              name: string;
              path: string;
              kind: "file" | "directory";
              children?: unknown[];
            }>;
          }>,
        );
      }
    }
  };

  walk(nodes);
  return items;
}

/** Map host settings skills → typeahead items (enabled only; description optional). */
export function skillsToSearchItems(
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    enabled?: boolean;
  }>,
): SearchableItem<SkillSearchAux>[] {
  return skills
    .filter((skill) => skill.enabled !== false)
    .map((skill) => {
      const description = oneLineDescription(skill.description);
      return {
        id: skill.id,
        label: skill.name,
        ...(description
          ? { auxiliaryData: { description } satisfies SkillSearchAux }
          : {}),
      };
    });
}

/**
 * Map host-advertised agents/contexts → typeahead items.
 * Use for snapshot expansion / list methods when the host provides agents.
 */
export function agentsToSearchItems(
  agents: Array<{ id: string; name: string; enabled?: boolean }>,
): SearchableItem[] {
  return agents
    .filter((agent) => agent.enabled !== false)
    .map((agent) => ({
      id: agent.id,
      label: agent.name,
    }));
}

/** Map host-advertised workflows → typeahead items. */
export function workflowsToSearchItems(
  workflows: Array<{ id: string; name: string; enabled?: boolean }>,
): SearchableItem[] {
  return workflows
    .filter((workflow) => workflow.enabled !== false)
    .map((workflow) => ({
      id: workflow.id,
      label: workflow.name,
    }));
}
