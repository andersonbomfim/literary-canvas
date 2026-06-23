import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

export const ACTIVE_WORK_STORAGE_KEY = "literary-canvas-active-work-id";

function readStoredWorkId() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ACTIVE_WORK_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function writeStoredWorkId(workId: number | null) {
  if (typeof window === "undefined") return;
  if (!workId) {
    window.localStorage.removeItem(ACTIVE_WORK_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_WORK_STORAGE_KEY, String(workId));
}

const INACTIVE_STATUSES = new Set(["paused", "completed", "archived"]);
let activeWorkIdSnapshot: number | null = readStoredWorkId();
const activeWorkListeners = new Set<() => void>();

function isProductionWork(work: { status?: string | null }) {
  return !INACTIVE_STATUSES.has(work.status || "");
}

/**
 * Lê o ID atual sem causar efeito colateral. Antes esta função mutava o
 * snapshot global em silêncio (sem notificar listeners) durante uma "leitura",
 * o que deixava componentes React com valor diferente do estado interno do
 * hook. Agora: sincronização real passa por `setActiveWorkIdSnapshot`, e a
 * leitura aqui apenas reflete o que estiver mais atualizado entre snapshot
 * e localStorage — sem mutação.
 */
export function getActiveWorkIdFromStorage() {
  const stored = readStoredWorkId();
  if (stored !== activeWorkIdSnapshot) {
    setActiveWorkIdSnapshot(stored);
  }
  return activeWorkIdSnapshot;
}

function setActiveWorkIdSnapshot(workId: number | null) {
  const next = workId && Number.isFinite(workId) && workId > 0 ? workId : null;
  if (activeWorkIdSnapshot === next) return false;
  activeWorkIdSnapshot = next;
  writeStoredWorkId(next);
  activeWorkListeners.forEach(listener => listener());
  return true;
}

function subscribeActiveWork(listener: () => void) {
  activeWorkListeners.add(listener);
  return () => {
    activeWorkListeners.delete(listener);
  };
}

export function useActiveWork() {
  const utils = trpc.useUtils();
  const worksQuery = trpc.works.list.useQuery();
  const [activeWorkId, setActiveWorkIdState] = useState<number | null>(
    () => activeWorkIdSnapshot
  );

  useEffect(
    () => subscribeActiveWork(() => setActiveWorkIdState(activeWorkIdSnapshot)),
    []
  );

  const setActiveWorkId = useCallback(
    (workId: number | null) => {
      const works = (worksQuery.data?.data || []).filter(work => !work.deletedAt);
      const target = workId ? works.find(work => work.id === workId) : null;
      const next =
        target && isProductionWork(target)
          ? target.id
          : workId && !target
            ? workId
            : null;

      if (setActiveWorkIdSnapshot(next)) {
        void utils.invalidate();
      }
    },
    [utils, worksQuery.data]
  );

  useEffect(() => {
    if (!worksQuery.data) return;
    const works = worksQuery.data?.data.filter(work => !work.deletedAt);
    if (works.length === 0) {
      if (activeWorkId) setActiveWorkId(null);
      return;
    }

    const productionWorks = works.filter(isProductionWork);
    const availableIds = new Set(productionWorks.map(work => work.id));

    // Only planning/in-progress works can occupy the active production slot.
    if (!activeWorkId || !availableIds.has(activeWorkId)) {
      const defaultWork = productionWorks.find(
        work => work.id === worksQuery.data?.defaultWorkId
      );
      const next = defaultWork?.id ?? productionWorks[0]?.id ?? null;
      setActiveWorkId(next);
      return;
    }

    // If the selected work was paused/completed/archived, remove it from active production.
    const currentWork = works.find(w => w.id === activeWorkId);
    if (currentWork && INACTIVE_STATUSES.has(currentWork.status || "")) {
      setActiveWorkId(productionWorks[0]?.id ?? null);
    }
  }, [worksQuery.data, activeWorkId]);

  const activeWork = useMemo(() => {
    const works = (worksQuery.data?.data || []).filter(work => !work.deletedAt);
    const work = works.find(work => work.id === activeWorkId);
    return work && isProductionWork(work) ? work : null;
  }, [worksQuery.data, activeWorkId]);

  const works = useMemo(
    () => (worksQuery.data?.data || []).filter(work => !work.deletedAt),
    [worksQuery.data]
  );

  return {
    activeWorkId,
    activeWork,
    works,
    isLoading: worksQuery.isLoading,
    refetch: worksQuery.refetch,
    setActiveWorkId,
  };
}
