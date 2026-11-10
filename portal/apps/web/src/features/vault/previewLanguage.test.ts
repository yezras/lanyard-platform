import { describe, expect, it } from "vitest";

import { languageFromPath } from "./previewLanguage.js";

describe("languageFromPath", () => {
  it("maps common code extensions", () => {
    expect(languageFromPath("/src/app.ts")).toBe("typescript");
    expect(languageFromPath("Component.tsx")).toBe("typescript");
    expect(languageFromPath("index.js")).toBe("javascript");
    expect(languageFromPath("config.json")).toBe("json");
    expect(languageFromPath("main.py")).toBe("python");
    expect(languageFromPath("lib.rs")).toBe("rust");
    expect(languageFromPath("main.go")).toBe("go");
    expect(languageFromPath("App.java")).toBe("java");
    expect(languageFromPath("script.sh")).toBe("bash");
    expect(languageFromPath("config.yaml")).toBe("yaml");
    expect(languageFromPath("config.yml")).toBe("yaml");
    expect(languageFromPath("Cargo.toml")).toBe("toml");
    expect(languageFromPath("styles.css")).toBe("css");
    expect(languageFromPath("query.sql")).toBe("sql");
  });

  it("returns plaintext for unknown or extensionless paths", () => {
    expect(languageFromPath("README")).toBe("plaintext");
    expect(languageFromPath("notes.txt")).toBe("plaintext");
    expect(languageFromPath("app.weirdext")).toBe("plaintext");
  });
});
