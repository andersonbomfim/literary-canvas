const UPPERCASE_LETTER = "A-Z\\u00C0-\\u017F";
const NAME = `[${UPPERCASE_LETTER}][\\w\\u00C0-\\u017F-]+`;
const DICENDI_VERBS =
  "disse|perguntou|respondeu|comentou|murmurou|sussurrou|gritou|exclamou|retrucou|replicou|prosseguiu|continuou|confessou|admitiu|explicou|explicara|indagou|insistiu|observou|completou|concluiu|acrescentou|interrompeu|chamou|avisou|ordenou|pediu|falou";
const NARRATIVE_TAG_VERBS =
  "soou|soara|pareceu|assentiu|sorriu|franziu|respirou|encarou|olhou|baixou|ergueu|hesitou|gemeu|suspirou|riu|cedeu";
const NARRATOR_TAG = `(?:(?:${DICENDI_VERBS})\\b|${NAME}\\s+(?:${DICENDI_VERBS}|${NARRATIVE_TAG_VERBS})\\b)`;

const SENTENCE_BOUNDARY = /([.!?\u2026])\s+(?=[A-Z\u00C0-\u017F])/g;
const OPENING_SPEECH_START = new RegExp(
  `([.!?:\\u2026][)"'\\u201D\\u2019]?)\\s+(\\u2014\\s+(?!${NARRATOR_TAG})(?=[${UPPERCASE_LETTER}]))`,
  "g"
);
const NARRATOR_TAG_AFTER_DASH = new RegExp(`^\\u2014\\s*${NARRATOR_TAG}`, "i");
const SPEAKER_NAME_PATTERNS = [
  new RegExp(`\\u2014\\s*(?:${DICENDI_VERBS})\\s+(${NAME})`, "gi"),
  new RegExp(
    `\\u2014\\s*(${NAME})\\s+(?:${DICENDI_VERBS}|${NARRATIVE_TAG_VERBS})\\b`,
    "gi"
  ),
];
const SAME_SPEAKER_TAIL_LIMIT = 260;

type SpeakerMatch = {
  name: string;
  endIndex: number;
};

function breakOpeningSpeechStarts(text: string) {
  return text.replace(OPENING_SPEECH_START, "$1\n$2");
}

function keepDashWithFollowingWord(text: string) {
  return text.replace(/\u2014[\u2060\u00A0 \t]+(?=\S)/g, "\u2014\u2060\u00A0");
}

function splitSentences(block: string) {
  return block
    .replace(SENTENCE_BOUNDARY, "$1\n")
    .split("\n")
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function splitLongNarrativeBlock(block: string): string[] {
  const cleanBlock = breakOpeningSpeechStarts(block)
    .replace(/[ \t]+/g, " ")
    .trim();

  if (cleanBlock.includes("\n")) {
    return cleanBlock
      .split(/\n+/)
      .flatMap(piece =>
        piece.trim().startsWith("\u2014")
          ? [piece.trim()]
          : splitLongNarrativeBlock(piece)
      )
      .filter(Boolean);
  }

  if (cleanBlock.length < 720) return [cleanBlock];

  const sentences = splitSentences(cleanBlock);
  if (sentences.length < 2) return [cleanBlock];

  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (current && next.length > 640 && current.length > 320) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

function lastNamedSpeaker(line: string): SpeakerMatch | null {
  let speaker: SpeakerMatch | null = null;
  let speakerIndex = -1;

  for (const pattern of SPEAKER_NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match) {
      const index = match.index ?? -1;
      if (index >= speakerIndex) {
        speaker = {
          name: match[1] ?? "",
          endIndex: index + match[0].length,
        };
        speakerIndex = index;
      }
      match = pattern.exec(line);
    }
  }

  return speaker?.name ? speaker : null;
}

function hasRecentSpeakerAttribution(line: string, speaker: SpeakerMatch) {
  const tail = line.slice(speaker.endIndex).trim();
  const sentenceStops = tail.match(/[.!?\u2026]/g)?.length ?? 0;
  return tail.length <= SAME_SPEAKER_TAIL_LIMIT && sentenceStops <= 1;
}

function shouldMergeDashLine(previous: string | undefined, current: string) {
  if (!previous || !current.startsWith("\u2014")) return false;
  if (!previous.trim().startsWith("\u2014")) return false;
  if (NARRATOR_TAG_AFTER_DASH.test(current)) return true;

  const previousSpeaker = lastNamedSpeaker(previous);
  if (!previousSpeaker) return false;
  if (!hasRecentSpeakerAttribution(previous, previousSpeaker)) return false;

  const currentSpeaker = lastNamedSpeaker(current);
  return (
    !currentSpeaker ||
    currentSpeaker.name.toLowerCase() === previousSpeaker.name.toLowerCase()
  );
}

function normalizeDashParagraphs(lines: string[]) {
  const paragraphs: string[] = [];

  for (const line of lines) {
    const previous = paragraphs[paragraphs.length - 1];

    if (shouldMergeDashLine(previous, line)) {
      paragraphs[paragraphs.length - 1] = `${previous} ${line}`;
    } else {
      paragraphs.push(line);
    }
  }

  return paragraphs;
}

export function normalizePortugueseProseLayout(raw: string) {
  const normalized = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u2014[\u2060\u00A0 \t]+/g, "\u2014 ")
    .replace(/[ \t]+[\u2013\u2014][ \t]+/g, " \u2014 ")
    .replace(/\u2014[ \t]*\n(?=[A-Z\u00C0-\u017F])/g, "\u2014 ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  if (!normalized) return "";

  const withSpeechStarts = breakOpeningSpeechStarts(normalized);
  const lines = withSpeechStarts
    .split(/\n+/)
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  return normalizeDashParagraphs(lines)
    .flatMap(line =>
      line.startsWith("\u2014") ? [line] : splitLongNarrativeBlock(line)
    )
    .join("\n")
    .split("\n")
    .map(keepDashWithFollowingWord)
    .join("\n");
}
