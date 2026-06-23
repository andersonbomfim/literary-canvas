import { invokeLLM } from "../_core/llm";
import { PROMPT_HARDENING_CLAUSE, escapePromptInjection } from "../_core/promptSanitize";

export type GenerationPromptInput = {
  title: string;
  sceneContext: string;
  authorStyle: string;
  libraryContext: string;
  negativeRules: string[];
  universeContext: string;
  styleRepertoire: string;
  characterContexts: Array<{ name: string; history: string; role: string }>;
  referenceContexts: Array<{ title: string; content: string; notes: string; sourceType: string; fileName: string }>;
  storyFoundation: string;
  continuityMemories: Array<{
    chapterId: number;
    chapterTitle: string;
    summary: string;
    stateChanges: string[];
    canonicalFacts: string[];
    openLoops: string[];
    impactedCharacters: string[];
  }>;
};

export function normalizeOptionalTitle(value: string | null | undefined) {
  const title = value?.trim() || "";
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!title) return "";
  if (normalized === "rascunho sem titulo") return "";
  return title;
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function clipped(value: string | null | undefined, maxChars: number) {
  const text = value?.trim() ?? "";
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(" ", maxChars);
  const end = cut > maxChars * 0.82 ? cut : maxChars;
  return `${text.slice(0, end).trim()}\n[contexto recortado para reduzir custo; dossies importados continuam sendo prioridade]`;
}

function extractGeneratedTitle(raw: string) {
  const cleaned = stripCodeFence(raw);
  const titleLine = cleaned.match(/^\s*T[IÍ]TULO(?:[\s_]+PROVIS[ÓO]RIO)?\s*:\s*(.+)\s*$/im);
  if (!titleLine) return { title: "", content: cleaned };

  const title = titleLine[1]
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .slice(0, 255);
  const withoutTitle = cleaned.replace(titleLine[0], "").trim();
  const content = withoutTitle.replace(/^\s*CAP[IÍ]TULO\s*:\s*/i, "").trim();
  return { title, content };
}

function buildPrompt(input: GenerationPromptInput, requestedMaxOutputWords: number) {
  const providedTitle = normalizeOptionalTitle(input.title);
  const needsProvisionalTitle = !providedTitle;
  const characterContext = input.characterContexts
    .map((character) => `**${character.name}** (${character.role || "personagem"}): ${clipped(character.history, 1200)}`)
    .join("\n\n") || "Não informado";
  const referenceContext = input.referenceContexts.length
    ? input.referenceContexts.map((item) =>
      `**${item.title}**${item.sourceType ? ` (${item.sourceType})` : ""}${item.fileName ? ` - ${item.fileName}` : ""}\n${item.notes ? `Notas: ${item.notes}\n` : ""}${clipped(item.content, 56_000)}`,
    ).join("\n\n----------------\n\n")
    : "Nenhuma referência ativa";
  const continuityContext = [
    input.storyFoundation.trim() ? `Base canônica da obra ou da série:\n${input.storyFoundation.trim()}` : "",
    input.continuityMemories.length
      ? `Memória dos capítulos finalizados:\n${input.continuityMemories.slice(-20).map((item) =>
        `Capítulo ${item.chapterId}: ${item.chapterTitle}\nResumo: ${item.summary}${item.stateChanges.length ? `\nMudanças de estado: ${item.stateChanges.join("; ")}` : ""}${item.canonicalFacts.length ? `\nFatos canônicos: ${item.canonicalFacts.join("; ")}` : ""}${item.openLoops.length ? `\nPontas em aberto: ${item.openLoops.join("; ")}` : ""}${item.impactedCharacters.length ? `\nPersonagens impactados: ${item.impactedCharacters.join(", ")}` : ""}`,
      ).join("\n\n----------------\n\n")}`
      : "",
  ].filter(Boolean).join("\n\n================\n\n") || "Nenhuma memória de continuidade carregada";
  const styleContext = [
    input.authorStyle.trim() ? `Essência de escrita absorvida no Perfil:\n${input.authorStyle.trim()}` : "",
    input.styleRepertoire.trim() ? `Repertório técnico por gênero para evitar prosa genérica:\n${input.styleRepertoire.trim()}` : "",
  ].filter(Boolean).join("\n\n================\n\n") || "Não informado";

  const systemPrompt = `Você é um assistente literário para escrever capítulos a partir do rascunho bruto do autor.

Regra principal: o rascunho do autor é matéria-prima, não sugestão decorativa. Leia tudo, preserve intenção, fatos, personagens, ordem emocional, detalhes concretos, conflitos e falas intocáveis. Transforme material bruto em capítulo literário completo sem trocar a história por uma premissa genérica.

Use Estilo como essência de escrita: ponto de vista, distância emocional, cadência, densidade descritiva, ritmo de frase, ritmo de parágrafo, diálogo, subtexto, escolha lexical, silêncio, tensão, humor e lógica emocional. Não copie frases, cenas, personagens, imagens específicas ou eventos de nenhuma amostra.

Use personagens como fichas vivas de cena: motivações, relações, medos, contradições, voz, limites canônicos e gatilhos devem afetar comportamento, fala e escolhas. Não trate personagens como nomes soltos.

Use Universo, referências e continuidade como cânone. Se algo estiver incerto, escreva sem contradizer o que foi dado.

Escreva como literatura, não como resumo. Evite explicação emocional óbvia, frases de preenchimento, didatismo e tom de IA.

Teto operacional: gere no máximo ${requestedMaxOutputWords} palavras. O teto é limite, não meta.

Regra de prioridade: quando houver dossies importados por capitulo/bloco, eles tem prioridade sobre fichas de personagens, universo e biblioteca. Fichas extraidas sao apoio editavel; nao use ficha, biblioteca ou universo para inventar fato que nao apareca nos dossies ou no rascunho.

${PROMPT_HARDENING_CLAUSE}`;

  const outputInstruction = needsProvisionalTitle
    ? `Como o autor não informou título, crie um título provisório curto, literário e específico a partir do rascunho.
Responda exatamente neste formato:
TITULO_PROVISORIO: [título]
CAPITULO:
[capítulo final em prosa corrida, sem cabeçalhos dentro do texto]`
    : "Escreva o capítulo final em prosa corrida, sem cabeçalhos extras.";

  const userPrompt = `Título: ${providedTitle || "Não informado pelo autor; gere título provisório."}

${styleContext}

Rascunho bruto / contexto do autor:
${escapePromptInjection(input.sceneContext)}

Memória factual da obra importada:
${escapePromptInjection(referenceContext)}

Contexto de personagens:
${escapePromptInjection(characterContext)}

Memória de continuidade:
${escapePromptInjection(continuityContext)}

Biblioteca canônica:
${escapePromptInjection(clipped(input.libraryContext, 7000) || "Não informado")}

Universo:
${escapePromptInjection(clipped(input.universeContext || (input.negativeRules.length ? input.negativeRules.map((rule) => `- ${rule}`).join("\n") : "Não informado"), 7000))}

${outputInstruction}`;

  return { systemPrompt, userPrompt, needsProvisionalTitle, providedTitle };
}

export async function generateWithCurrentEngine(input: GenerationPromptInput, requestedMaxOutputWords: number) {
  const { systemPrompt, userPrompt, needsProvisionalTitle, providedTitle } = buildPrompt(input, requestedMaxOutputWords);
  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const messageContent = response.choices[0]?.message?.content;
  const generatedContent = typeof messageContent === "string" ? messageContent.trim() : "";
  if (!generatedContent) throw new Error("A IA não retornou conteúdo válido.");

  if (!needsProvisionalTitle) {
    return { title: providedTitle, content: generatedContent, userPrompt };
  }

  const parsed = extractGeneratedTitle(generatedContent);
  return {
    title: parsed.title || "Capítulo provisório",
    content: parsed.content || generatedContent,
    userPrompt,
  };
}
