/**
 * Hermes first-class projects (portal SoT for vault multi-root).
 * Source of truth on disk: `$HERMES_HOME/projects.db`.
 */

export type HermesProjectFolder = {
  /** Absolute filesystem path. */
  path: string;
  label?: string | null;
  is_primary: boolean;
};

export type HermesProject = {
  id: string;
  slug: string;
  name: string;
  primary_path: string | null;
  folders: HermesProjectFolder[];
};
