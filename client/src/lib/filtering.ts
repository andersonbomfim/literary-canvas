export function normalizeFilterText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchesFilterQuery(
  query: string,
  values: Array<string | number | null | undefined>
) {
  const normalizedQuery = normalizeFilterText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeFilterText(values.filter(Boolean).join(" "));
  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every(token => haystack.includes(token));
}

export function toggleSetValue<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
