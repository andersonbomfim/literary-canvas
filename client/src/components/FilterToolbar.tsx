import { useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterChipOption = {
  value: string;
  label: string;
  count?: number;
  className?: string;
};

type FilterToolbarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  resultCount?: number;
  totalCount?: number;
  resultLabel?: string;
  filterCount?: number;
  activeFiltersLabel?: string;
  hasActiveFilters?: boolean;
  onClear?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type FilterChipGroupProps = {
  label: string;
  options: FilterChipOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  mode?: "single" | "multiple";
  allLabel?: string;
  allCount?: number;
  allValue?: string;
  onClear?: () => void;
  className?: string;
};

function countLabel(count: number | undefined) {
  return typeof count === "number" ? count.toLocaleString("pt-BR") : null;
}

export function FilterToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar",
  resultCount,
  totalCount,
  resultLabel = "resultado(s)",
  filterCount = 0,
  activeFiltersLabel,
  hasActiveFilters,
  onClear,
  actions,
  children,
  className,
}: FilterToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSearch = typeof searchValue === "string" && onSearchChange;
  const showClear = Boolean(hasActiveFilters && onClear);
  const showFilters = Boolean(children);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/75 p-2 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showSearch ? (
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={event => onSearchChange(event.target.value)}
                className="h-10 bg-secondary/60 pl-9 pr-9"
                placeholder={searchPlaceholder}
              />
              {searchValue ? (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  aria-label="Limpar busca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          {showFilters ? (
            <Button
              type="button"
              variant={filtersOpen || filterCount ? "secondary" : "outline"}
              className="shrink-0"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(open => !open)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Filtros
              {filterCount ? (
                <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
                  {filterCount}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 lg:justify-end">
          {actions}
          {typeof resultCount === "number" ? (
            <div className="rounded-md border border-border/70 bg-background/45 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {resultCount.toLocaleString("pt-BR")}
              </span>{" "}
              {resultLabel}
              {typeof totalCount === "number" ? (
                <span> de {totalCount.toLocaleString("pt-BR")}</span>
              ) : null}
            </div>
          ) : null}
          {showClear ? (
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              <X className="mr-2 h-4 w-4" />
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      {showFilters && filtersOpen ? (
        <div className="mt-2 rounded-md border border-border/70 bg-background/55 p-3">
          <div className="flex min-w-0 flex-wrap items-start gap-4">
            {children}
          </div>
          {hasActiveFilters && activeFiltersLabel ? (
            <div className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              {activeFiltersLabel}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterChipGroup({
  label,
  options,
  selectedValues,
  onToggle,
  mode = "multiple",
  allLabel,
  allCount,
  allValue = "all",
  onClear,
  className,
}: FilterChipGroupProps) {
  const allSelected =
    mode === "single"
      ? selectedValues[0] === allValue || selectedValues.length === 0
      : selectedValues.length === 0;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {allLabel ? (
          <button
            type="button"
            onClick={() => {
              if (mode === "single") onToggle(allValue);
              else onClear?.();
            }}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
              allSelected
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-secondary/55 text-foreground hover:border-accent/60"
            )}
          >
            {allLabel}
            {countLabel(allCount) ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px]",
                  allSelected
                    ? "bg-accent-foreground/20 text-accent-foreground"
                    : "bg-background text-muted-foreground"
                )}
              >
                {countLabel(allCount)}
              </span>
            ) : null}
          </button>
        ) : null}

        {options.map(option => {
          const selected = selectedValues.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                selected
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-secondary/55 text-foreground hover:border-accent/60",
                option.className
              )}
            >
              {option.label}
              {countLabel(option.count) ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px]",
                    selected
                      ? "bg-accent-foreground/20 text-accent-foreground"
                      : "bg-background text-muted-foreground"
                  )}
                >
                  {countLabel(option.count)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
