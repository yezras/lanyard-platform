import { describe, expect, it } from "vitest";

import {
  chatWorkingDirectoryMetadata,
  resolveChatWorkingDirectory,
} from "../src/chat-working-directory.js";

describe("resolveChatWorkingDirectory", () => {
  it("returns trimmed primary_path-style absolute paths", () => {
    expect(resolveChatWorkingDirectory("/Projects/B")).toBe("/Projects/B");
    expect(resolveChatWorkingDirectory("  /home/agent/B  ")).toBe(
      "/home/agent/B",
    );
  });

  it("returns null for missing or blank scope", () => {
    expect(resolveChatWorkingDirectory(null)).toBeNull();
    expect(resolveChatWorkingDirectory(undefined)).toBeNull();
    expect(resolveChatWorkingDirectory("")).toBeNull();
    expect(resolveChatWorkingDirectory("   ")).toBeNull();
  });
});

describe("chatWorkingDirectoryMetadata", () => {
  it("stamps working_directory from project B primary_path", () => {
    const pathB = "/Projects/B";
    const workingDirectory = resolveChatWorkingDirectory(pathB);
    expect(chatWorkingDirectoryMetadata(workingDirectory)).toEqual({
      working_directory: pathB,
      project_vault_path: pathB,
    });
  });

  it("omits metadata when no project is selected", () => {
    expect(chatWorkingDirectoryMetadata(null)).toBeUndefined();
    expect(
      chatWorkingDirectoryMetadata(resolveChatWorkingDirectory(null)),
    ).toBeUndefined();
  });
});
