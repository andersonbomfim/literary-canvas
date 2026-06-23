import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Clock, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface VersionHistoryProps {
  chapterId: number;
}

/**
 * VersionHistory Component - Display chapter version history with diff comparison
 */
export function VersionHistory({ chapterId }: VersionHistoryProps) {
  const [selectedVersion1, setSelectedVersion1] = useState<number | null>(null);
  const [selectedVersion2, setSelectedVersion2] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const { data: versions, isLoading } = trpc.versions?.list.useQuery({
    chapterId,
  });
  const { data: comparison, isLoading: isComparingLoading } =
    trpc.versions?.compare.useQuery(
      {
        chapterId,
        versionId1: selectedVersion1 || 0,
        versionId2: selectedVersion2 || 0,
      },
      {
        enabled:
          showComparison &&
          selectedVersion1 !== null &&
          selectedVersion2 !== null,
      }
    );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    );
  }

  if (!versions?.data || versions?.data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Nenhuma versão disponível
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Version List */}
      <div className="space-y-2">
        <h3 className="font-medium text-foreground">Historico de Versoes</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {versions?.data.map(version => (
            <Card
              key={version.id}
              className="bg-card border border-border p-3 cursor-pointer hover:border-accent/50 transition-colors"
              onClick={() => {
                if (selectedVersion1 === null) {
                  setSelectedVersion1(version.id);
                } else if (
                  selectedVersion2 === null &&
                  selectedVersion1 !== version.id
                ) {
                  setSelectedVersion2(version.id);
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    Versão {version.versionNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {version.changeDescription}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <Clock className="inline w-3 h-3 mr-1" />
                    {formatDistanceToNow(new Date(version.createdAt), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {version.contentLength} caracteres
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Version Selection */}
      {(selectedVersion1 || selectedVersion2) && (
        <Card className="bg-card border border-border p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {selectedVersion1
                ? `Versão ${versions?.data.find(v => v.id === selectedVersion1)?.versionNumber ?? selectedVersion1}`
                : "Selecione"}
            </span>
            <ArrowRight className="w-4 h-4 text-accent" />
            <span className="text-muted-foreground">
              {selectedVersion2
                ? `Versão ${versions?.data.find(v => v.id === selectedVersion2)?.versionNumber ?? selectedVersion2}`
                : "Selecione"}
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedVersion1(null);
                setSelectedVersion2(null);
                setShowComparison(false);
              }}
            >
              Limpar
            </Button>
            <Button
              size="sm"
              disabled={
                !selectedVersion1 || !selectedVersion2 || isComparingLoading
              }
              onClick={() => setShowComparison(!showComparison)}
            >
              {isComparingLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Comparando...
                </>
              ) : (
                "Comparar"
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Comparison Results */}
      {showComparison && comparison?.data && (
        <Card className="bg-card border border-border p-4 space-y-3">
          <h4 className="font-medium text-foreground">Diferenças</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">
                Versão {comparison?.data.version1.number}
              </p>
              <p className="text-foreground">
                {comparison?.data.version1.lines} linhas
              </p>
              <p className="text-foreground">
                {comparison?.data.version1.words} palavras
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                Versão {comparison?.data.version2.number}
              </p>
              <p className="text-foreground">
                {comparison?.data.version2.lines} linhas
              </p>
              <p className="text-foreground">
                {comparison?.data.version2.words} palavras
              </p>
            </div>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-green-500">
                +{comparison?.data.changes.linesAdded} linhas
              </span>
              <span className="text-red-500">
                -{comparison?.data.changes.linesRemoved} linhas
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              +{comparison?.data.changes.wordsAdded} palavras
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
