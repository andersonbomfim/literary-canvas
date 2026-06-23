import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function BookExport() {
  const chaptersQuery = trpc.writing.list.useQuery({});
  const [exporting, setExporting] = useState(false);

  const canonicalChapters = useMemo(() => {
    return (chaptersQuery.data?.data || []).filter(
      (c: any) => c.status === "canonical"
    );
  }, [chaptersQuery.data]);

  const allChapters = useMemo(() => {
    return (chaptersQuery.data?.data || []).filter(
      (c: any) => c.status !== "discarded"
    );
  }, [chaptersQuery.data]);

  const exportMutation = trpc.export.multipleChaptersToDOCX.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success("Livro exportado com sucesso!");
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = data.fileName;
        link.click();
      }
      setExporting(false);
    },
    onError: error => {
      toast.error(`Erro ao exportar: ${error.message}`);
      setExporting(false);
    },
  });

  const handleExport = (chapters: any[], label: string) => {
    if (!chapters.length) {
      toast.error("Nenhum capítulo disponível para exportar.");
      return;
    }
    setExporting(true);
    exportMutation.mutate({
      chapterIds: chapters.map((c: any) => c.id),
      bookTitle: label,
    });
  };

  return (
    <Card className="border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-accent" />
        <h3 className="font-display text-lg text-foreground">
          Exportar manuscrito
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Feche os capítulos aprovados em um único arquivo Word (.docx). Use
        “Todos” apenas para conferência interna.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={exporting || !canonicalChapters.length}
          onClick={() =>
            handleExport(canonicalChapters, "Livro — Capítulos Canônicos")
          }
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Aprovados ({canonicalChapters.length})
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exporting || !allChapters.length}
          onClick={() =>
            handleExport(allChapters, "Livro — Todos os Capítulos")
          }
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Todos para conferência ({allChapters.length})
        </Button>
      </div>
      {!canonicalChapters.length && !chaptersQuery.isLoading && (
        <p className="text-xs text-muted-foreground">
          Nenhum capítulo canônico ainda. Aprove capítulos na revisão para
          exportar.
        </p>
      )}
    </Card>
  );
}
