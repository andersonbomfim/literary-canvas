import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { CalendarDays, CircleDot, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  parseKeyChapters,
  type ImportedTimelineEvent,
} from "@/lib/keyChapters";
import { parseUniverseProfile } from "@/lib/universeProfile";
import { parseContinuityMemories } from "@shared/continuity";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;

type CharacterTimelineProps = {
  profile: RouterOutputs["profile"]["get"];
  profileLoading: boolean;
};

type SourceType = "universe" | "reference" | "memory";

type TimelineEntry = {
  id: string;
  yearLabel: string;
  sortYear: number;
  title: string;
  description: string;
  sourceLabel: string;
  sourceType: SourceType;
  confidence: "high" | "medium" | "low";
};

const yearPattern = /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/g;
const undatedSort = Number.MAX_SAFE_INTEGER / 2;

const MONTH_MAP: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};
const monthNames = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length);
function cleanText(value: string | null) {
  return (value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function previewText(value: string, maxLength = 820) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function getYears(text: string) {
  return Array.from(
    new Set(Array.from(text.matchAll(yearPattern), match => Number(match[1])))
  ).sort((a, b) => a - b);
}

function yearLabelFromText(text: string) {
  const [year] = getYears(text);
  return year ? String(year) : "Sem data";
}

function yearLabelFromPeriod(period: string, description: string) {
  const periodYear = yearLabelFromText(period);
  if (periodYear !== "Sem data") return periodYear;
  return yearLabelFromText(description);
}

function shouldShowPeriodInDescription(period: string, yearLabel: string) {
  const normalizedPeriod = normalizeSignature(period);
  const normalizedYear = normalizeSignature(yearLabel);
  if (!normalizedPeriod || normalizedPeriod === normalizedYear) return false;

  return ![
    "ordem narrativa",
    "sequencia narrativa",
    "sem data",
    "periodo indefinido",
  ].includes(normalizedPeriod);
}

function descriptionWithPeriod(
  period: string,
  description: string,
  yearLabel: string
) {
  const cleanPeriod = cleanText(period);
  const cleanDescription = cleanText(description);
  if (!shouldShowPeriodInDescription(cleanPeriod, yearLabel)) {
    return cleanDescription;
  }

  const descriptionSignature = normalizeSignature(cleanDescription);
  const periodSignature = normalizeSignature(cleanPeriod);
  if (descriptionSignature.includes(periodSignature)) {
    return cleanDescription;
  }

  return `${cleanPeriod} - ${cleanDescription}`;
}

/** Extract a precise sort key: year * 10000 + month * 100 + day. */
function getChronoSortKey(text: string): number | null {
  const lower = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const original = text.toLowerCase();

  for (const name of monthNames) {
    const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const regex = new RegExp(
      `(?:(\\d{1,2})\\s+(?:de\\s+)?)?${normalized}\\s+(?:de\\s+)?(1[5-9]\\d{2}|20\\d{2}|21\\d{2})`,
      "i"
    );
    const match = lower.match(regex);
    if (match) {
      const day = Math.min(Math.max(Number(match[1] ?? 0), 0), 31);
      const year = Number(match[2]);
      const month = MONTH_MAP[name] ?? 0;
      return year * 10000 + month * 100 + day;
    }
    const regexOrig = new RegExp(
      `(?:(\\d{1,2})\\s+(?:de\\s+)?)?${name}\\s+(?:de\\s+)?(1[5-9]\\d{2}|20\\d{2}|21\\d{2})`,
      "i"
    );
    const matchOrig = original.match(regexOrig);
    if (matchOrig) {
      const day = Math.min(Math.max(Number(matchOrig[1] ?? 0), 0), 31);
      const year = Number(matchOrig[2]);
      const month = MONTH_MAP[name] ?? 0;
      return year * 10000 + month * 100 + day;
    }
  }

  // Fall back to just year
  const years = getYears(text);
  return years.length > 0 ? years[0] * 10000 : null;
}

function importedEventSortKey(
  period: string,
  description: string,
  fallbackOrder: number
) {
  const periodKey = getChronoSortKey(period);
  if (periodKey != null) return periodKey + fallbackOrder * 0.001;

  const descriptionKey = getChronoSortKey(description);
  if (descriptionKey != null) return descriptionKey + fallbackOrder * 0.001;

  return undatedSort + fallbackOrder;
}

function normalizeSignature(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitEventCandidates(text: string) {
  const clean = cleanText(text);
  if (!clean) return [];

  const splitBracketedEntries = (value: string) =>
    value
      .replace(/\s+(?=\[(?:1[5-9]\d{2}|20\d{2}|21\d{2}|s[eé]culo|seculo|d[eé]cada|decada|anos)\b)/gi, "\n")
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length >= 24);

  const lines = clean
    .split(/\n+/)
    .map(line => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .flatMap(line => splitBracketedEntries(line))
    .filter(line => line.length >= 24);

  if (lines.length > 1) return lines;

  return splitBracketedEntries(clean)
    .flatMap(line =>
      line.split(/(?<=[.!])\s+(?=[A-ZÁÀÂÃÉÈÊÍÓÔÕÚÇ0-9\[])/)
    )
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 40);
}

function extractLeadingPeriod(text: string) {
  const bracket = text.match(/^\s*\[([^\]]{2,64})\]/);
  return bracket?.[1]?.trim() ?? "";
}

function hasMultipleYearMentions(text: string) {
  return getYears(text).length > 1;
}

function displayTextWithoutLeadingPeriod(text: string) {
  return text.replace(/^\s*\[[^\]]+\]\s*[-:–—]?\s*/, "").trim();
}

function dateSourceForTextCandidate(text: string, requireExplicitPeriod: boolean) {
  const leadingPeriod = extractLeadingPeriod(text);
  if (leadingPeriod) return leadingPeriod;
  if (requireExplicitPeriod && hasMultipleYearMentions(text)) return "";
  return text;
}

function titleSourceForTextCandidate(text: string) {
  const displayText = displayTextWithoutLeadingPeriod(text);
  return displayText || text;
}

function eventTitle(text: string) {
  const cleaned = cleanText(text).replace(/^[-*•:;\d.)\s\[\]]+/, "");
  const [prefix] = cleaned.split(/\s[:;-]\s/);
  if (prefix && prefix.length >= 8 && prefix.length <= 86) return prefix;
  return previewText(cleaned, 88);
}

function sourceTone(sourceType: SourceType) {
  switch (sourceType) {
    case "universe":
      return "border-sky-500/30 bg-sky-500/10 text-sky-200";
    case "reference":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "memory":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
}

function entriesFromText(options: {
  baseId: string;
  text: string;
  sourceLabel: string;
  sourceType: SourceType;
  requireYear: boolean;
  requireExplicitPeriod?: boolean;
}) {
  const candidates = splitEventCandidates(options.text);

  return candidates.flatMap<TimelineEntry>((candidate, index) => {
    const dateSource = dateSourceForTextCandidate(
      candidate,
      options.requireExplicitPeriod ?? false
    );
    if (!dateSource) return [];

    const years = getYears(dateSource);
    if (options.requireYear && years.length === 0) return [];

    const year = years[0];
    const chronoKey = getChronoSortKey(dateSource);
    // Use chrono key for precise sorting, with source order as tiebreaker
    const sortValue = chronoKey ?? (year ? year * 10000 : undatedSort);

    // Clean leading markers like "[ANO] - " from display text
    const displayText = displayTextWithoutLeadingPeriod(candidate);
    const titleSource = titleSourceForTextCandidate(candidate);

    return [
      {
        id: `${options.baseId}-${index}`,
        yearLabel: year ? String(year) : "Sem data",
        sortYear: sortValue + index * 0.001, // preserve source order as tiebreaker
        title: eventTitle(titleSource),
        description: previewText(displayText),
        sourceLabel: options.sourceLabel,
        sourceType: options.sourceType,
        confidence: year ? "medium" : "low",
      },
    ];
  });
}

function entriesFromImportedEvents(options: {
  baseId: string;
  events: ImportedTimelineEvent[];
  sourceLabel: string;
}) {
  return options.events
    .slice()
    .sort((a, b) => a.order - b.order)
    .map<TimelineEntry>((event, index) => {
      const period = cleanText(event.period) || "Ordem narrativa";
      const description = cleanText(event.description);
      const yearLabel = yearLabelFromPeriod(period, description);
      const fallbackOrder = event.order || index + 1;
      const sortKey = importedEventSortKey(
        period,
        description,
        fallbackOrder
      );

      return {
        id: `${options.baseId}-event-${event.order || index}`,
        yearLabel,
        sortYear: sortKey,
        title: cleanText(event.title) || eventTitle(description),
        description: previewText(
          descriptionWithPeriod(period, description, yearLabel),
          900
        ),
        sourceLabel: options.sourceLabel,
        sourceType: "reference",
        confidence: event.confidence ?? "high",
      };
    })
    .filter(entry => entry.description.length > 0);
}

function buildTimeline(profile: RouterOutputs["profile"]["get"]) {
  const entries: TimelineEntry[] = [];

  const universeProfile = parseUniverseProfile(profile?.negativeRules);
  if (universeProfile.timeline) {
    entries.push(
      ...entriesFromText({
        baseId: "universe-timeline",
        text: universeProfile.timeline,
        sourceLabel: "Universo",
        sourceType: "universe",
        requireYear: true,
        requireExplicitPeriod: true,
      })
    );
  }

  const keyChapters = parseKeyChapters(profile?.keyChapters);
  keyChapters.customReferences
    .filter(reference => reference.isActive)
    .forEach(reference => {
      if (reference.importedTimelineEvents?.length) {
        entries.push(
          ...entriesFromImportedEvents({
            baseId: `reference-${reference.id}`,
            events: reference.importedTimelineEvents,
            sourceLabel: reference.title,
          })
        );
        return;
      }

      const sectionContent = (ids: string[]) =>
        (reference.summarySections ?? [])
          .filter(section => ids.includes(section.id))
          .map(section => section.content)
          .join("\n");
      const explicitChronology = sectionContent([
        "eventos",
        "events",
        "timeline",
        "cronologia",
      ]);
      const universeChronology = sectionContent([
        "universo",
        "universe",
        "world",
        "mundo",
      ]);
      const chronologyText = [explicitChronology, universeChronology]
        .map(value => cleanText(value ?? null))
        .filter(Boolean)
        .join("\n");

      entries.push(
        ...entriesFromText({
          baseId: `reference-${reference.id}`,
          text: chronologyText,
          sourceLabel: reference.title,
          sourceType: "reference",
          requireYear: !explicitChronology,
        })
      );
    });

  const continuityMemories = parseContinuityMemories(
    profile?.continuityMemories
  );
  continuityMemories
    .filter(memory => memory.isActive)
    .forEach((memory, index) => {
      const content = [
        memory.chapterTitle,
        memory.summary,
        memory.stateChanges.join(". "),
        memory.canonicalFacts.join(". "),
        memory.openLoops.join(". "),
      ]
        .map(cleanText)
        .filter(Boolean)
        .join(". ");
      const years = getYears(content);
      const year = years[0];

      entries.push({
        id: `memory-${memory.id ?? index}`,
        yearLabel: year ? String(year) : "Sem data",
        sortYear: year ? year * 10000 + index * 0.001 : undatedSort + index,
        title: memory.chapterTitle || `Capítulo ${memory.chapterId}`,
        description: previewText(content),
        sourceLabel: memory.chapterId
          ? `Capítulo ${memory.chapterId}`
          : "Memória narrativa",
        sourceType: "memory",
        confidence: year ? "medium" : "low",
      });
    });

  const seen = new Set<string>();
  return entries
    .filter(entry => entry.description.length > 0)
    .filter(entry => {
      const signature = `${normalizeSignature(entry.title)}:${normalizeSignature(entry.description).slice(0, 260)}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((a, b) => a.sortYear - b.sortYear);
}

export function CharacterTimeline({
  profile,
  profileLoading = false,
}: CharacterTimelineProps) {
  const entries = useMemo(() => buildTimeline(profile), [profile]);

  const groups = useMemo(() => {
    const grouped = new Map<string, TimelineEntry[]>();
    entries.forEach(entry => {
      grouped.set(entry.yearLabel, [
        ...(grouped.get(entry.yearLabel) ?? []),
        entry,
      ]);
    });
    return Array.from(grouped.entries()).map(([yearLabel, items]) => ({
      yearLabel,
      items,
      sortYear: items[0].sortYear ?? undatedSort,
    }));
  }, [entries]);

  if (profileLoading) {
    return (
      <Card className="border-border/70 bg-card/80 p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Carregando cronologia da obra...
        </div>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="border-border/70 bg-card/80 p-6">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <h3 className="font-serif text-lg font-semibold text-foreground">
              Cronologia da obra
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Nenhum acontecimento com ano ou período foi encontrado ainda.
              Importe uma referência completa ou preencha a seção Universo com a
              linha temporal da obra para organizar os eventos por data.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl font-semibold text-foreground">
            Cronologia da obra
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Acontecimentos organizados por ano, com fonte, confiança da data e
            impacto narrativo.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-accent/30 bg-accent/10 text-accent"
        >
          {entries.length} evento(s)
        </Badge>
      </div>

      <div className="relative space-y-6 pl-0 md:pl-20">
        <div className="pointer-events-none absolute left-16 top-2 hidden h-full w-px bg-border/80 md:block" />
        {groups.map(group => (
          <section key={group.yearLabel} className="relative">
            <div className="mb-3 flex items-center gap-3 md:absolute md:-left-20 md:mb-0 md:w-16 md:justify-end">
              <Badge className="relative z-10 min-w-14 justify-center border-accent/30 bg-background px-2.5 py-1 font-serif text-sm text-accent shadow-[0_0_0_3px_hsl(var(--background))]">
                {group.yearLabel}
              </Badge>
            </div>

            <div className="space-y-3">
              {group.items.map(entry => (
                <Card
                  key={entry.id}
                  className="border-border/70 bg-card/80 p-4"
                >
                  <div className="flex gap-3">
                    <CircleDot className="mt-1 h-4 w-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-serif text-base font-semibold text-foreground">
                          {entry.title}
                        </h4>
                        <Badge
                          variant="outline"
                          className={sourceTone(entry.sourceType)}
                        >
                          {entry.sourceLabel}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {entry.description}
                      </p>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-2">
                          <span className="block uppercase tracking-wide text-muted-foreground/70">
                            Ano
                          </span>
                          <span className="mt-1 block text-foreground">
                            {entry.yearLabel}
                          </span>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-2">
                          <span className="block uppercase tracking-wide text-muted-foreground/70">
                            Fonte
                          </span>
                          <span className="mt-1 block text-foreground">
                            {entry.sourceLabel}
                          </span>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-2">
                          <span className="block uppercase tracking-wide text-muted-foreground/70">
                            Confiança
                          </span>
                          <span className="mt-1 block text-foreground">
                            {entry.confidence === "high"
                              ? "sequência importada"
                              : entry.confidence === "medium"
                                ? "data encontrada"
                                : "revisar data"}
                          </span>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-2">
                          <span className="block uppercase tracking-wide text-muted-foreground/70">
                            Impacto
                          </span>
                          <span className="mt-1 block text-foreground">
                            continuidade
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
