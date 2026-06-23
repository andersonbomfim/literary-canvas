import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, FileText, File } from "lucide-react";
import { toast } from "sonner";

interface ExportChapterProps {
  chapterId: number;
  chapterTitle: string;
}

type ExportFormat = "pdf" | "docx" | "epub";

/**
 * ExportChapter Component - Export chapter to multiple formats
 */
export function ExportChapter({ chapterId, chapterTitle }: ExportChapterProps) {
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null
  );

  const exportToPDF = trpc.export.toPDF.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Capítulo exportado como PDF`);
        // Trigger download
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = data.fileName;
        link.click();
      }
      setExportingFormat(null);
    },
    onError: error => {
      toast.error(`Erro ao exportar: ${error.message}`);
      setExportingFormat(null);
    },
  });

  const exportToDOCX = trpc.export.toDOCX.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Capítulo exportado como DOCX`);
        // Trigger download
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = data.fileName;
        link.click();
      }
      setExportingFormat(null);
    },
    onError: error => {
      toast.error(`Erro ao exportar: ${error.message}`);
      setExportingFormat(null);
    },
  });

  const exportToEPUB = trpc.export.toEPUB.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Capítulo exportado como EPUB`);
        // Trigger download
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = data.fileName;
        link.click();
      }
      setExportingFormat(null);
    },
    onError: error => {
      toast.error(`Erro ao exportar: ${error.message}`);
      setExportingFormat(null);
    },
  });

  const handleExport = (format: ExportFormat) => {
    setExportingFormat(format);
    if (format === "pdf") {
      exportToPDF.mutate({ chapterId });
    } else if (format === "docx") {
      exportToDOCX.mutate({ chapterId });
    } else if (format === "epub") {
      exportToEPUB.mutate({ chapterId });
    }
  };

  const exportOptions = [
    {
      format: "pdf" as ExportFormat,
      label: "PDF",
      description: "Documento portátil",
      icon: File,
      color: "text-red-500",
    },
    {
      format: "docx" as ExportFormat,
      label: "Word",
      description: "Editável em Word",
      icon: FileText,
      color: "text-blue-500",
    },
    {
      format: "epub" as ExportFormat,
      label: "EPUB",
      description: "E-book",
      icon: FileText,
      color: "text-purple-500",
    },
  ];

  return (
    <Card className="bg-card border border-border p-4 space-y-4">
      <div>
        <h3 className="font-medium text-foreground mb-1">Exportar Capítulo</h3>
        <p className="text-sm text-muted-foreground">
          Baixe "{chapterTitle}" em diferentes formatos
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {exportOptions.map(option => {
          const Icon = option.icon;
          const isExporting = exportingFormat === option.format;

          return (
            <Button
              key={option.format}
              variant="outline"
              size="sm"
              disabled={exportingFormat !== null && !isExporting}
              onClick={() => handleExport(option.format)}
              className="flex flex-col items-center gap-1 h-auto py-3"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Icon className={`w-4 h-4 ${option.color}`} />
                  <span className="text-xs">{option.label}</span>
                </>
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded p-2">
        <Download className="w-3 h-3" />
        <span>Os arquivos serão baixados automaticamente</span>
      </div>
    </Card>
  );
}
