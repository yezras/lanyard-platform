import { isVaultPathAllowed } from "@lanyard/shared";
import { HTTPException } from "hono/http-exception";

import type { UserRbac } from "../control-plane-client.js";
import { assertVaultPathAccess } from "../rbac.js";
import { buildAclRoots, filterEntriesByAcl } from "./acl-filter.js";
import type {
  VaultContentProvider,
  VaultEntry,
  VaultFileContent,
  VaultIndexProvider,
  VaultSearchResponse,
  VaultTreeNode,
} from "./types.js";

export class VaultService {
  constructor(
    private readonly provider: VaultContentProvider,
    private readonly indexProvider: VaultIndexProvider,
  ) {}

  async getTree(rbac: UserRbac): Promise<{ roots: VaultTreeNode[] }> {
    const fullTree = await this.provider.getTree();
    const roots = buildAclRoots(rbac.allowed_path_prefixes, fullTree);
    return { roots };
  }

  async listEntries(
    rbac: UserRbac,
    path: string,
  ): Promise<{ path: string; entries: VaultEntry[] }> {
    const result = assertVaultPathAccess(rbac, path);
    const rawEntries = await this.provider.listEntries(result.path);
    const entries = filterEntriesByAcl(
      rbac.allowed_path_prefixes,
      rawEntries,
    );
    return { path: result.path, entries };
  }

  async readContent(
    rbac: UserRbac,
    path: string,
  ): Promise<VaultFileContent> {
    const result = assertVaultPathAccess(rbac, path);
    const content = await this.provider.readFile(result.path);
    if (!content) {
      throw new HTTPException(404, { message: "Vault file not found" });
    }
    return content;
  }

  async search(rbac: UserRbac, query: string): Promise<VaultSearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      throw new HTTPException(400, { message: "q query parameter is required" });
    }

    const [lastIndexedAt, rawHits] = await Promise.all([
      this.indexProvider.getLastIndexedAt(),
      this.indexProvider.search(trimmed),
    ]);

    const results = rawHits.filter((hit) =>
      isVaultPathAllowed(rbac.allowed_path_prefixes, hit.path),
    );

    return {
      query: trimmed,
      last_indexed_at: lastIndexedAt,
      results,
    };
  }
}