import type { VaultIndexProvider, VaultSearchHit } from "./types.js";

type IndexedDocument = {
  path: string;
  title: string;
  body: string;
};

/** Stable timestamp for fixture index staleness display in tests. */
export const FIXTURE_INDEX_LAST_INDEXED_AT = "2026-03-15T08:00:00.000Z";

const FIXTURE_INDEX_DOCUMENTS: IndexedDocument[] = [
  {
    path: "/Projects/A/README.md",
    title: "README.md",
    body: "Team A vault slice welcome kickoff onboarding",
  },
  {
    path: "/Projects/A/notes.md",
    title: "notes.md",
    body: "Notes kickoff complete next vault browser slice twelve",
  },
  {
    path: "/Projects/A/Subfolder/detail.md",
    title: "detail.md",
    body: "Detail nested markdown under Team A subfolder",
  },
  {
    path: "/Projects/B/secret.md",
    title: "secret.md",
    body: "Secret team B only confidential roadmap",
  },
  {
    path: "/Projects/B/plan.md",
    title: "plan.md",
    body: "Plan B roadmap milestones quarterly goals",
  },
  {
    path: "/Projects/C/hidden.md",
    title: "hidden.md",
    body: "Hidden project C should never appear for AB roles",
  },
];

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function scoreDocument(doc: IndexedDocument, tokens: string[]): number {
  const haystack = `${doc.path} ${doc.title} ${doc.body}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
      if (doc.title.toLowerCase().includes(token)) {
        score += 0.5;
      }
      if (doc.path.toLowerCase().includes(token)) {
        score += 0.25;
      }
    }
  }
  return score;
}

function buildSnippet(body: string, tokens: string[]): string {
  const lower = body.toLowerCase();
  let matchIndex = -1;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      matchIndex = index;
      break;
    }
  }

  if (matchIndex < 0) {
    return body.slice(0, 120);
  }

  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(body.length, matchIndex + 80);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end)}${suffix}`;
}

export function createFixtureVaultIndexProvider(): VaultIndexProvider {
  return {
    async getLastIndexedAt(): Promise<string> {
      return FIXTURE_INDEX_LAST_INDEXED_AT;
    },

    async search(query: string): Promise<VaultSearchHit[]> {
      const tokens = tokenize(query);
      if (tokens.length === 0) {
        return [];
      }

      const hits: VaultSearchHit[] = [];
      for (const doc of FIXTURE_INDEX_DOCUMENTS) {
        const score = scoreDocument(doc, tokens);
        if (score <= 0) {
          continue;
        }
        hits.push({
          path: doc.path,
          title: doc.title,
          snippet: buildSnippet(doc.body, tokens),
          score,
        });
      }

      return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    },
  };
}