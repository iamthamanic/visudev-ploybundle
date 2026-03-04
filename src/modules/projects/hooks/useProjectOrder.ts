/**
 * Persistierte Projekt-Reihenfolge und Anpinnen (localStorage).
 * Location: src/modules/projects/hooks/useProjectOrder.ts
 */

import { useCallback, useState } from "react";

const STORAGE_KEY = "visudev-projects-order";

interface StoredOrder {
  order: string[];
  pinned: string[];
}

function load(): StoredOrder {
  if (typeof window === "undefined") return { order: [], pinned: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], pinned: [] };
    const parsed = JSON.parse(raw) as StoredOrder;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
    };
  } catch {
    return { order: [], pinned: [] };
  }
}

function save(data: StoredOrder) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function useProjectOrder() {
  const [state, setState] = useState<StoredOrder>(load);

  const setOrder = useCallback((order: string[]) => {
    setState((prev) => {
      const next = { ...prev, order };
      save(next);
      return next;
    });
  }, []);

  const setPinned = useCallback((pinned: string[]) => {
    setState((prev) => {
      const next = { ...prev, pinned };
      save(next);
      return next;
    });
  }, []);

  const togglePinned = useCallback((projectId: string) => {
    setState((prev) => {
      const pinned = prev.pinned.includes(projectId)
        ? prev.pinned.filter((id) => id !== projectId)
        : [...prev.pinned, projectId];
      const next = { ...prev, pinned };
      save(next);
      return next;
    });
  }, []);

  /** Verschiebt ein Projekt an die neue Position. currentOrderedIds = IDs der aktuell angezeigten Liste (nach Sortierung). */
  const moveProject = useCallback(
    (projectId: string, toIndex: number, currentOrderedIds: string[]) => {
      const order = [...currentOrderedIds];
      const from = order.indexOf(projectId);
      if (from === -1) {
        order.splice(toIndex, 0, projectId);
      } else {
        order.splice(from, 1);
        order.splice(Math.min(toIndex, order.length), 0, projectId);
      }
      setOrder(order);
    },
    [setOrder],
  );

  return {
    order: state.order,
    pinned: state.pinned,
    setOrder,
    setPinned,
    togglePinned,
    moveProject,
  };
}

/**
 * Sortiert Projekte: zuerst alle angepinnten (in order-Reihenfolge, dann nicht in order nach createdAt),
 * dann alle nicht angepinnten (in order, dann nicht in order nach createdAt).
 */
export function sortProjectsByOrder<T extends { id: string; createdAt: string }>(
  projects: T[],
  order: string[],
  pinned: string[],
): T[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const orderSet = new Set(order);
  const pinnedSet = new Set(pinned);
  const inOrder = order.filter((id) => byId.has(id));
  const pinnedInOrder = inOrder.filter((id) => pinnedSet.has(id));
  const unpinnedInOrder = inOrder.filter((id) => !pinnedSet.has(id));
  const notInOrder = projects.filter((p) => !orderSet.has(p.id));
  const pinnedNotInOrder = notInOrder
    .filter((p) => pinnedSet.has(p.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const unpinnedNotInOrder = notInOrder
    .filter((p) => !pinnedSet.has(p.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const result: T[] = [];
  for (const id of pinnedInOrder) {
    const p = byId.get(id);
    if (p) result.push(p);
  }
  result.push(...pinnedNotInOrder);
  for (const id of unpinnedInOrder) {
    const p = byId.get(id);
    if (p) result.push(p);
  }
  result.push(...unpinnedNotInOrder);
  return result;
}
