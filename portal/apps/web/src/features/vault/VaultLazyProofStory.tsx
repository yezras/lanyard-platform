/**
 * Auth-free story for browser QA of lazy Vault folder loading (lp-ypx.13).
 *
 * Mounted with `?story=vault-lazy-proof`. The story installs an in-browser
 * fetch mock before VaultView mounts, then drives the real Vault UI against a
 * 501-file folder split over two entries pages.
 */

import type { CSSProperties } from "react";

import type {
  VaultEntriesResponse,
  VaultFileContent,
  VaultTreeResponse,
} from "../../api/types.js";
import {
  PortalHonestyProvider,
  type PortalHonestyContextValue,
} from "../honesty/index.js";

import { VaultView } from "./VaultView.js";

const PROJECT_PATH = "/Vault proof";
const HUGE_FOLDER_PATH = `${PROJECT_PATH}/Huge folder`;
const PAGE_SIZE = 200;
const TOTAL_FILES = 501;
const SECOND_PAGE_CURSOR = "page-2";

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  minHeight: 0,
};

const honestyValue: PortalHonestyContextValue = {
  brainRpcEnabled: true,
  isReady: true,
  ui: null,
  backendCapabilities: null,
};

type ProofWindow = Window & {
  __vaultLazyProofFetchLog?: string[];
};

function proofWindow(): ProofWindow {
  return window as ProofWindow;
}

function fileName(index: number): string {
  return `note-${index.toString().padStart(3, "0")}.md`;
}

const generatedFiles = Array.from({ length: TOTAL_FILES }, (_, offset) => {
  const index = offset + 1;
  const name = fileName(index);
  return {
    name,
    path: `${HUGE_FOLDER_PATH}/${name}`,
    kind: "file" as const,
    mime_type: "text/markdown",
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function vaultTreeResponse(): VaultTreeResponse {
  return {
    roots: [
      {
        name: "Vault proof",
        path: PROJECT_PATH,
        kind: "directory",
        description: "Large-tree lazy loading proof fixture",
        children: [
          {
            name: "Huge folder",
            path: HUGE_FOLDER_PATH,
            kind: "directory",
          },
        ],
      },
    ],
    source: "story",
    truncated: true,
    truncated_reason: "node_budget",
  };
}

function vaultEntriesResponse(cursor: string | null): VaultEntriesResponse {
  const entries =
    cursor === SECOND_PAGE_CURSOR
      ? generatedFiles.slice(PAGE_SIZE)
      : generatedFiles.slice(0, PAGE_SIZE);
  return {
    path: HUGE_FOLDER_PATH,
    entries,
    source: "story",
    truncated: cursor !== SECOND_PAGE_CURSOR,
    next_cursor: cursor === SECOND_PAGE_CURSOR ? null : SECOND_PAGE_CURSOR,
  };
}

function vaultContentResponse(path: string): VaultFileContent {
  const name = path.split("/").at(-1) ?? path;
  const match = /^note-(\d+)\.md$/.exec(name);
  const index = match ? Number(match[1]) : 0;
  return {
    path,
    mime_type: "text/markdown",
    encoding: "utf-8",
    content:
      `# ${name}\n\n` +
      `Lazy-loaded proof file ${index} opened from the paged Vault entries endpoint.\n`,
  };
}

let mockInstalled = false;

function installVaultLazyProofFetchMock(): void {
  if (mockInstalled) {
    return;
  }
  mockInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const win = proofWindow();
  win.__vaultLazyProofFetchLog = [];

  window.fetch = async (input, init) => {
    const url = new URL(requestUrl(input), window.location.href);
    const method =
      init?.method ??
      (typeof input !== "string" && !(input instanceof URL)
        ? input.method
        : "GET");
    win.__vaultLazyProofFetchLog?.push(`${method} ${url.pathname}${url.search}`);

    if (url.pathname.endsWith("/api/vault/tree")) {
      return jsonResponse(vaultTreeResponse());
    }

    if (url.pathname.endsWith("/api/vault/entries")) {
      const path = url.searchParams.get("path");
      if (path !== HUGE_FOLDER_PATH) {
        return jsonResponse({ error: `unexpected entries path: ${path}` }, 404);
      }
      return jsonResponse(vaultEntriesResponse(url.searchParams.get("cursor")));
    }

    if (url.pathname.endsWith("/api/vault/content")) {
      const path = url.searchParams.get("path") ?? "";
      if (!path.startsWith(`${HUGE_FOLDER_PATH}/note-`)) {
        return jsonResponse({ error: `unexpected content path: ${path}` }, 404);
      }
      return jsonResponse(vaultContentResponse(path));
    }

    if (url.pathname.endsWith("/api/vault/search")) {
      return jsonResponse({
        query: url.searchParams.get("q") ?? "",
        last_indexed_at: new Date(0).toISOString(),
        results: [],
      });
    }

    return originalFetch(input, init);
  };
}

export function VaultLazyProofStory() {
  installVaultLazyProofFetchMock();

  return (
    <PortalHonestyProvider value={honestyValue}>
      <div data-testid="vault-lazy-proof-story" style={rootStyle}>
        <VaultView
          treePollIntervalMs={0}
          canVaultEdit={false}
          onlyOfficeEditorEnabled={false}
        />
      </div>
    </PortalHonestyProvider>
  );
}
