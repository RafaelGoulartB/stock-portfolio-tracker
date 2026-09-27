import type { AllocationFilterState } from "@/components/allocation/allocation-filters";

/** Allocation status follows whether a target is defined, even with no position. */
export function matchesStatus(
  filters: AllocationFilterState,
  targetWeight: string | null,
): boolean {
  if (filters.status === "invested") {
    return targetWeight !== null;
  }

  if (filters.status === "radar") {
    return targetWeight === null;
  }

  return true;
}
