import { createElement } from "react";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { GROUP_ROOM_FIXTURE_PARTICIPANTS } from "../../api/groupRoom.js";

import {
  agentsToSearchItems,
  buildComposerTriggers,
  DEFAULT_CHAT_TAGS,
  renderSkillTypeaheadItem,
  skillDescriptionFromItem,
  skillsToSearchItems,
  tokensFromMessageContent,
  vaultPathsToSearchItems,
  workflowsToSearchItems,
} from "./chatComposerTriggers.js";
import { rosterToSearchItems } from "./groupRoom.js";

describe("chatComposerTriggers", () => {
  it("builds / @ # triggers with full host inventory sources", () => {
    const triggers = buildComposerTriggers({
      skills: [{ id: "sum", label: "summarize" }],
      contexts: [{ id: "/Business/Contracts/MSA.docx", label: "MSA.docx" }],
      roster: [{ id: "agent", label: "agent" }],
      tags: DEFAULT_CHAT_TAGS,
    });

    expect(triggers.map((t) => t.character)).toEqual(["/", "@", "#"]);

    const skillToken = triggers[0]!.onSelect({ id: "sum", label: "summarize" });
    expect(skillToken).toMatchObject({
      value: "/summarize",
      label: "/summarize",
      variant: "yellow",
    });

    const mentionToken = triggers[1]!.onSelect({
      id: "agent",
      label: "agent",
    });
    expect(mentionToken).toMatchObject({
      value: "@agent",
      variant: "blue",
    });

    const tagToken = triggers[2]!.onSelect({ id: "todo", label: "todo" });
    expect(tagToken).toMatchObject({
      value: "#todo",
      label: "#todo",
      variant: "purple",
    });
  });

  it("lists fixture host skills A,B on / when inventory provided", async () => {
    const triggers = buildComposerTriggers({
      skills: [
        { id: "a", label: "skill-a" },
        { id: "b", label: "skill-b" },
      ],
    });
    const slash = triggers.find((t) => t.character === "/");
    expect(slash).toBeDefined();
    const results = await Promise.resolve(slash!.searchSource.search(""));
    expect(results.map((r) => r.label)).toEqual(["skill-a", "skill-b"]);
  });

  it("omits / and @ when inventory empty — no summarize or researcher/writer stubs", async () => {
    const triggers = buildComposerTriggers({
      skills: [],
      contexts: [],
    });

    expect(triggers.map((t) => t.character)).toEqual(["#"]);
    expect(triggers.some((t) => t.character === "/")).toBe(false);
    expect(triggers.some((t) => t.character === "@")).toBe(false);

    // Explicit regression: no default agent stubs in production path.
    const emptyDefault = buildComposerTriggers();
    expect(emptyDefault.map((t) => t.character)).toEqual(["#"]);
    for (const trigger of emptyDefault) {
      const items = await Promise.resolve(trigger.searchSource.search(""));
      const labels = items.map((i) => i.label.toLowerCase());
      expect(labels).not.toContain("researcher");
      expect(labels).not.toContain("writer");
      expect(labels).not.toContain("summarize");
      expect(labels).not.toContain("agent");
    }
  });

  it("filters skill source by query via createStaticSource", async () => {
    const triggers = buildComposerTriggers({
      skills: [
        { id: "s1", label: "summarize" },
        { id: "s2", label: "translate" },
      ],
    });
    const source = triggers.find((t) => t.character === "/")!.searchSource;
    const results = await Promise.resolve(source.search("sum"));
    expect(results.map((r) => r.label)).toEqual(["summarize"]);
  });

  it("adds $ workflow trigger only when host advertises workflows", async () => {
    const without = buildComposerTriggers({
      skills: [{ id: "s", label: "skill" }],
    });
    expect(without.some((t) => t.character === "$")).toBe(false);

    const withWorkflows = buildComposerTriggers({
      workflows: [{ id: "daily-brief", label: "daily-brief" }],
    });
    const wf = withWorkflows.find((t) => t.character === "$");
    expect(wf).toBeDefined();
    const token = wf!.onSelect({ id: "daily-brief", label: "daily-brief" });
    expect(token).toMatchObject({
      value: "$daily-brief",
      variant: "green",
    });
    const results = await Promise.resolve(wf!.searchSource.search(""));
    expect(results.map((r) => r.id)).toEqual(["daily-brief"]);
  });

  it("U3: group roster wins @ complete over vault contexts", async () => {
    const triggers = buildComposerTriggers({
      contexts: [{ id: "/README.md", label: "README.md" }],
      roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
    });
    const mention = triggers.find((t) => t.character === "@");
    expect(mention).toBeDefined();
    expect(mention!.menuLabel).toBe("Room");
    const results = await Promise.resolve(mention!.searchSource.search(""));
    expect(results.map((r) => r.label)).toEqual([
      "here",
      "Alice",
      "Skip",
      "Lev",
      "Bana",
    ]);
    expect(results.map((r) => r.id)).not.toContain("/README.md");
    const lev = mention!.onSelect({
      id: "lev",
      label: "Lev",
      auxiliaryData: { mention: true },
    });
    // lp-8sh4.4: roster mentions insert the display name, never the raw id.
    expect(lev).toMatchObject({ value: "@Lev", label: "@Lev", variant: "blue" });

    const multi = mention!.onSelect({
      id: "agt_123",
      label: "Taste A 1787593336",
      auxiliaryData: { mention: true },
    });
    expect(multi).toMatchObject({
      value: "@Taste A 1787593336",
      label: "@Taste A 1787593336",
      variant: "blue",
    });
  });

  it("lp-v62i.2.2: @ typeahead never includes vault path rows", async () => {
    const vaultContext = {
      id: "/Business/Contracts/MSA.docx",
      label: "MSA.docx",
    };

    const vaultOnly = buildComposerTriggers({ contexts: [vaultContext] });
    expect(vaultOnly.some((t) => t.character === "@")).toBe(false);

    const withRoster = buildComposerTriggers({
      contexts: [vaultContext],
      roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
    });
    const mention = withRoster.find((t) => t.character === "@");
    expect(mention).toBeDefined();
    const results = await Promise.resolve(mention!.searchSource.search(""));
    expect(results.map((r) => r.id)).not.toContain(vaultContext.id);
    expect(results.map((r) => r.label)).not.toContain("MSA.docx");
    expect(results.map((r) => r.label)).toEqual([
      "here",
      "Alice",
      "Skip",
      "Lev",
      "Bana",
    ]);

    const selected = mention!.onSelect({
      id: "lev",
      label: "Lev",
      auxiliaryData: { mention: true },
    });
    expect(selected).toMatchObject({
      value: "@Lev",
      label: "@Lev",
      variant: "blue",
    });
    expect(selected.value).not.toContain("/Business/Contracts/MSA.docx");
  });

  it("lp-8sh4.4: mention menu rows render a dither icon, never a raw id", async () => {
    const triggers = buildComposerTriggers({
      roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
    });
    const mention = triggers.find((t) => t.character === "@");
    const rendered = mention!.renderItem?.({
      id: "skip",
      label: "Skip",
      auxiliaryData: { mention: true },
    });
    expect(rendered).toBeTruthy();
    const { container } = render(
      createElement(Theme, { theme: neutralTheme }, rendered),
    );
    expect(container.querySelector('[data-testid="dither-avatar"]')).toBeTruthy();

    const plain = mention!.renderItem?.({ id: "/README.md", label: "README.md" });
    const { container: plainContainer } = render(
      createElement(Theme, { theme: neutralTheme }, plain),
    );
    expect(
      plainContainer.querySelector('[data-testid="dither-avatar"]'),
    ).toBeNull();
  });

  it("extracts tokenized values from message content", () => {
    const tokens = tokensFromMessageContent(
      "Please /summarize @agent notes @Taste A 1787593336 @Taste and me #todo $daily-brief",
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        { value: "/summarize", label: "/summarize", variant: "yellow" },
        { value: "@agent", label: "@agent", variant: "blue" },
        { value: "@Taste A 1787593336", label: "@Taste A 1787593336", variant: "blue" },
        // Lowercase continuation words stay plain text (no over-capture).
        { value: "@Taste", label: "@Taste", variant: "blue" },
        { value: "@Taste A 1787593336", label: "@Taste A 1787593336", variant: "blue" },
        { value: "#todo", label: "#todo", variant: "purple" },
        { value: "$daily-brief", label: "$daily-brief", variant: "green" },
      ]),
    );
  });

  it("keeps multi-segment vault paths as one yellow token (lp-khq.4)", () => {
    const path = "/Business/Contracts/MSA.docx";
    const tokens = tokensFromMessageContent(
      `Please review ${path} and /summarize the terms`,
    );

    const yellow = tokens.filter((t) => t.variant === "yellow");
    expect(yellow).toEqual(
      expect.arrayContaining([
        { value: path, label: path, variant: "yellow" },
        { value: "/summarize", label: "/summarize", variant: "yellow" },
      ]),
    );
    // Must not split path into per-segment skill chips.
    expect(yellow.map((t) => t.value)).not.toContain("/Business");
    expect(yellow.map((t) => t.value)).not.toContain("/Contracts");
    expect(yellow.map((t) => t.value)).not.toContain("/MSA");
    // Exactly one token for the full path value.
    expect(yellow.filter((t) => t.value === path)).toHaveLength(1);
  });

  it("tokenizes isolated skills without requiring a multi-segment path", () => {
    const tokens = tokensFromMessageContent("/summarize this thread");
    expect(tokens).toEqual([
      { value: "/summarize", label: "/summarize", variant: "yellow" },
    ]);
  });

  it("keeps deep vault paths with dots/underscores as a single token", () => {
    const path =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";
    const tokens = tokensFromMessageContent(`Open ${path}`);
    expect(tokens).toEqual([
      { value: path, label: path, variant: "yellow" },
    ]);
  });

  it("maps skills, agents, workflows, and vault files to searchable items", () => {
    expect(
      skillsToSearchItems([
        { id: "a", name: "Alpha", enabled: true },
        { id: "b", name: "Beta", enabled: false },
      ]),
    ).toEqual([{ id: "a", label: "Alpha" }]);

    // Descriptions ride on auxiliaryData for TypeaheadItem secondary text.
    expect(
      skillsToSearchItems([
        {
          id: "sum",
          name: "summarize",
          description: "Condense long docs",
          enabled: true,
        },
        {
          id: "plain",
          name: "plain",
          description: "   ",
          enabled: true,
        },
      ]),
    ).toEqual([
      {
        id: "sum",
        label: "summarize",
        auxiliaryData: { description: "Condense long docs" },
      },
      { id: "plain", label: "plain" },
    ]);

    expect(
      agentsToSearchItems([
        { id: "researcher", name: "Researcher", enabled: true },
        { id: "writer", name: "Writer", enabled: false },
      ]),
    ).toEqual([{ id: "researcher", label: "Researcher" }]);

    expect(
      workflowsToSearchItems([
        { id: "wf1", name: "Brief", enabled: true },
        { id: "wf2", name: "Hidden", enabled: false },
      ]),
    ).toEqual([{ id: "wf1", label: "Brief" }]);

    const files = vaultPathsToSearchItems([
      {
        name: "Projects",
        path: "/Projects",
        kind: "directory",
        children: [
          {
            name: "README.md",
            path: "/Projects/README.md",
            kind: "file",
          },
        ],
      },
    ]);
    expect(files).toEqual([
      { id: "/Projects/README.md", label: "README.md" },
    ]);
  });

  it("wires skill description into / typeahead renderItem and keywords", async () => {
    const skillItems = skillsToSearchItems([
      {
        id: "sum",
        name: "summarize",
        description: "Condense long documents",
        enabled: true,
      },
      { id: "plain", name: "plain-skill", enabled: true },
    ]);
    expect(skillDescriptionFromItem(skillItems[0]!)).toBe(
      "Condense long documents",
    );
    expect(skillDescriptionFromItem(skillItems[1]!)).toBeUndefined();

    const triggers = buildComposerTriggers({ skills: skillItems });
    const slash = triggers.find((t) => t.character === "/");
    expect(slash).toBeDefined();
    expect(typeof slash!.renderItem).toBe("function");

    // Keyword search matches description text.
    const byDesc = await Promise.resolve(
      slash!.searchSource.search("condense"),
    );
    expect(byDesc.map((r) => r.label)).toEqual(["summarize"]);

    // renderItem returns a React element (TypeaheadItem) for both cases.
    const withDesc = renderSkillTypeaheadItem(skillItems[0]!);
    const nameOnly = renderSkillTypeaheadItem(skillItems[1]!);
    expect(withDesc).toBeTruthy();
    expect(nameOnly).toBeTruthy();
  });

  it("lp-v62i.27: group @ picker offers here as all members", async () => {
    const triggers = buildComposerTriggers({
      roster: rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS),
    });
    const mention = triggers.find((t) => t.character === "@");
    expect(mention).toBeDefined();
    const results = await Promise.resolve(mention!.searchSource.search(""));
    expect(results[0]).toMatchObject({
      id: "here",
      label: "here",
      auxiliaryData: { mention: true, roomAddress: true },
    });
    const token = mention!.onSelect(results[0]!);
    expect(token).toMatchObject({
      value: "@here",
      label: "@here",
      variant: "blue",
    });
    const filtered = await Promise.resolve(mention!.searchSource.search("he"));
    expect(filtered.map((r) => r.id)).toContain("here");
  });

  it("lp-cxhb.8 I10: channel roster @ completes members by durable id", async () => {
    const items = rosterToSearchItems(GROUP_ROOM_FIXTURE_PARTICIPANTS).filter(
      (item) => item.id !== "usr_alice",
    );
    const triggers = buildComposerTriggers({ roster: items });
    const mention = triggers.find((t) => t.character === "@");
    expect(mention).toBeDefined();
    const legal = await Promise.resolve(mention!.searchSource.search("lev"));
    expect(legal.map((r) => r.id)).toEqual(["lev"]);
    const token = mention!.onSelect({ id: "lev", label: "Lev" });
    expect(token.value).toBe("@lev");
  });

  it("lp-cxhb.8 I11: 1:1 @ offers only that thread's participants", async () => {
    const oneToOne = [
      { kind: "human" as const, user_id: "usr_alice", display_name: "Alice" },
      { kind: "persona" as const, persona_id: "agent-legal", display_name: "Legal" },
    ];
    const items = rosterToSearchItems(oneToOne);
    expect(items.map((item) => item.id)).toEqual(["usr_alice", "agent-legal"]);
    expect(items.map((item) => item.id)).not.toContain("here");
    const triggers = buildComposerTriggers({
      contexts: [{ id: "agent-ops", label: "Ops" }],
      roster: items,
    });
    const mention = triggers.find((t) => t.character === "@");
    expect(mention?.menuLabel).toBe("Room");
    const results = await Promise.resolve(mention!.searchSource.search(""));
    expect(results.map((item) => item.id)).toEqual([
      "usr_alice",
      "agent-legal",
    ]);
    expect(results.map((item) => item.id)).not.toContain("agent-ops");
  });
});
