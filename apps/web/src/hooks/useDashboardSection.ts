import { useCallback, useEffect, useState } from 'react';

/**
 * Dashboard section selector — top-nav tabs use this hook to drive which
 * pane is visible. State syncs to the URL `?section=` so refreshes and
 * bookmarks land in the same place.
 *
 * Sections are intentionally string literals (not an enum) so adding a
 * new section is a one-line union extension. Anything we don't recognize
 * falls back to "graph" — the explorer that existed before Phase 2.
 */
export type DashboardSection =
  | 'graph'
  | 'overview'
  | 'features'
  | 'history'
  | 'recipes'
  | 'projects';

const VALID_SECTIONS: ReadonlySet<DashboardSection> = new Set([
  'graph',
  'overview',
  'features',
  'history',
  'recipes',
  'projects',
]);

const SECTION_PARAM = 'section';
const DEFAULT_SECTION: DashboardSection = 'overview';

const readFromUrl = (): DashboardSection => {
  if (typeof window === 'undefined') return DEFAULT_SECTION;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(SECTION_PARAM);
  if (raw && VALID_SECTIONS.has(raw as DashboardSection)) {
    return raw as DashboardSection;
  }
  return DEFAULT_SECTION;
};

export interface UseDashboardSectionResult {
  section: DashboardSection;
  setSection: (next: DashboardSection) => void;
}

export const useDashboardSection = (): UseDashboardSectionResult => {
  const [section, setSectionState] = useState<DashboardSection>(() => readFromUrl());

  // Sync to URL when the user switches tabs.
  const setSection = useCallback((next: DashboardSection) => {
    setSectionState(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === DEFAULT_SECTION) {
      url.searchParams.delete(SECTION_PARAM);
    } else {
      url.searchParams.set(SECTION_PARAM, next);
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

  // React to back/forward navigation so the tab UI stays in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setSectionState(readFromUrl());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return { section, setSection };
};
