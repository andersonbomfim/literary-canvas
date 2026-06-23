import { describe, expect, it } from "vitest";
import { normalizeInspirationSuggestions } from "./drafts";

const currentDraftText = [
  "Margaery ficou onde estava, parada, imóvel.",
  "A respiração saiu do controle e o primeiro soluço veio mudo, preso no peito.",
  "Molhada, fedendo a urina, com o rosto inundado de lágrimas, entendeu enfim a medida exata da sua impotência.",
  "Perseus caminhou para os fundos da ala dos Loxley sem pressa, deixando a irmã sozinha na poltrona.",
  "Quase trinta anos dizendo a si mesma que era forte não apagaram o pavor antigo.",
  "Ela saiu depois de algum tempo, incapaz de transformar vergonha em confronto naquele instante.",
  "O corredor parecia longo demais, e cada retrato antigo parecia testemunhar sua derrota.",
  "Ainda assim, a confissão sobre Lombardo permanecia inteira dentro dela, pesada como uma lâmina guardada.",
  "Ao alcançar a porta, Margaery só pensava em não cair antes de encontrar água e silêncio.",
].join(" ");

const context = [
  "Obra ativa: MARGAERY",
  "---",
  `Trecho atual do rascunho (integral):\n${currentDraftText}`,
].join("\n\n");

describe("normalizeInspirationSuggestions", () => {
  it("aceita continuação com 'depois' sem tratar isso como diagnóstico de sequência", () => {
    const suggestions = normalizeInspirationSuggestions([
      {
        title: "Manter o medo como consequência imediata",
        description: "Margaery pode sair da ala tentando preservar dignidade enquanto a confissão de Perseus fica presa nela.",
        whyItFits: "O rascunho já mostra medo físico, vergonha e imobilidade como reação central da cena.",
        continuationHint: "Depois, mostrar Margaery buscando água e silêncio antes de decidir se contará algo a Astride.",
        affectedCharacters: ["Margaery", "Perseus", "Astride"],
        narrativeRisk: "Não transformar o trauma em vingança imediata, porque isso quebraria o pavor estabelecido.",
        evidence: ["Margaery ficou onde estava, parada, imóvel."],
      },
    ], context, currentDraftText);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].continuationHint).toContain("Depois");
  });

  it("recupera evidência do rascunho quando a IA retorna uma citação útil mas imprecisa", () => {
    const suggestions = normalizeInspirationSuggestions([
      {
        title: "Usar a confissão como peso interno, não como ação imediata",
        description: "A continuação deve deixar Margaery carregar a morte de Lombardo em silêncio antes de verbalizar qualquer acusação.",
        whyItFits: "O trecho estabelece Perseus como fonte de pavor e Margaery como incapaz de reagir ativamente naquele momento.",
        continuationHint: "Inserir uma passagem em que Margaery tenta se recompor e só então registra mentalmente a confissão.",
        affectedCharacters: ["Margaery", "Perseus", "Lombardo"],
        evidence: ["Margaery esta apavorada demais para reagir contra Perseus."],
      },
    ], context, currentDraftText);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].evidence.some((excerpt) => excerpt.includes("Margaery"))).toBe(true);
  });
});
