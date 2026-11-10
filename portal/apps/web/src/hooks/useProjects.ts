import { useCallback, useEffect, useState } from "react";

import { fetchProjects } from "../api/projects.js";
import type { Project } from "../api/types.js";

export type ProjectsState =
  | { status: "loading"; projects: Project[] }
  | { status: "ready"; projects: Project[] }
  | { status: "error"; projects: Project[] };

export type UseProjectsResult = ProjectsState & {
  refresh: () => Promise<Project[]>;
};

export function useProjects(): UseProjectsResult {
  const [state, setState] = useState<ProjectsState>({
    status: "loading",
    projects: [],
  });

  const refresh = useCallback(async () => {
    try {
      const projects = await fetchProjects();
      setState({ status: "ready", projects });
      return projects;
    } catch {
      setState((current) => ({ status: "error", projects: current.projects }));
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const projects = await fetchProjects();
        if (cancelled) return;
        setState({ status: "ready", projects });
      } catch {
        if (cancelled) return;
        // Honest empty: list unavailable is not a live zero-project Directory.
        setState({ status: "error", projects: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, refresh };
}
