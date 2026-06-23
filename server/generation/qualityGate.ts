import { countWords } from "./planConfig";

export class GenerationQualityError extends Error {
  code = "failed_quality_gate";

  constructor(message: string) {
    super(message);
    this.name = "GenerationQualityError";
  }
}

const STRUCTURAL_FAILURE_PATTERNS = [
  /\[object Object\]/i,
  /\bTraceback\b/i,
  /\bTypeError:/i,
  /\bReferenceError:/i,
  /\bSyntaxError:/i,
  /\bCannot read properties\b/i,
  /\bHTTP\s+5\d\d\b/i,
  /\bundefined undefined\b/i,
];

export function validateGenerationOutput(args: {
  content: string;
  requestedMaxOutputWords: number;
  dryRun?: boolean;
  sourceWordCount?: number;
  action?: string;
}) {
  const content = args.content.trim();
  if (!content) throw new GenerationQualityError("A geracao retornou vazia.");

  for (const pattern of STRUCTURAL_FAILURE_PATTERNS) {
    if (pattern.test(content)) {
      throw new GenerationQualityError("A geracao retornou um erro estrutural no lugar do capitulo.");
    }
  }

  const wordCount = countWords(content);
  let minimumWords = args.dryRun
    ? 20
    : Math.min(120, Math.max(30, Math.floor(args.requestedMaxOutputWords * 0.05)));

  if (!args.dryRun && args.action === "generate" && (args.sourceWordCount ?? 0) >= 1000) {
    const sourceFloor = Math.floor((args.sourceWordCount ?? 0) * 0.45);
    const outputFloor = Math.floor(args.requestedMaxOutputWords * 0.6);
    minimumWords = Math.max(minimumWords, Math.min(sourceFloor, outputFloor));
  }

  if (wordCount < minimumWords) {
    throw new GenerationQualityError(
      `A geracao retornou texto curto demais para o rascunho fornecido (${wordCount} palavras; minimo esperado: ${minimumWords}).`,
    );
  }
}
