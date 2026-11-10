/** Vault browser types (portal slice #12). */

export type VaultEntryKind = "file" | "directory";

export type VaultEntry = {
  name: string;
  path: string;
  kind: VaultEntryKind;
  mime_type?: string;
};

export type VaultTreeNode = VaultEntry & {
  children?: VaultTreeNode[];
  /**
   * Optional supporting text for tree UI (e.g. absolute disk path for Hermes
   * project roots).
   */
  description?: string;
};

export type VaultFileContent = {
  path: string;
  kind: "file";
  mime_type: string;
  encoding: "utf-8" | "base64";
  content: string;
  size_bytes: number;
};

/**
 * Read-only vault content from the customer brain.
 * CI uses {@link createFixtureVaultContentProvider}; local dev may use
 * {@link createFsVaultContentProvider} when `VAULT_ROOT` is set.
 * {@link createCpS3VaultContentProvider} maps CP HTTP list/get when
 * `VaultPlane=cp_s3` (lp-oop.11). Default plane is unchanged.
 */
export interface VaultContentProvider {
  listEntries(path: string): Promise<VaultEntry[]>;
  readFile(path: string): Promise<VaultFileContent | null>;
  /** Full vault tree for ACL filtering (customer index or recursive list). */
  getTree(): Promise<VaultTreeNode[]>;
}

/** One hit from the MemPalace / vault search index (portal slice #13). */
export type VaultSearchHit = {
  path: string;
  title: string;
  snippet: string;
  score: number;
};

export type VaultSearchResponse = {
  query: string;
  last_indexed_at: string;
  results: VaultSearchHit[];
};

/**
 * Search index on the customer brain (MemPalace / vault index export).
 * CI uses {@link createFixtureVaultIndexProvider}; production proxies customer index.
 */
export interface VaultIndexProvider {
  getLastIndexedAt(): Promise<string>;
  search(query: string): Promise<VaultSearchHit[]>;
}