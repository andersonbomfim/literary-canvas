import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type ParsedFile = {
  text: string;
  fileName: string;
  format: string;
};

const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".docx",
  ".pdf",
];
const MAX_PARSE_FILE_BYTES = 25 * 1024 * 1024;

export function isSupportedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function getSupportedExtensions(): string {
  return ".txt, .md, .markdown, .json, .docx, .pdf";
}

export function getAcceptString(): string {
  return ".txt,.md,.markdown,.json,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();

  if (!isSupportedFile(file.name)) {
    throw new Error(`Formato não suportado. Use ${getSupportedExtensions()}.`);
  }

  if (file.size > MAX_PARSE_FILE_BYTES) {
    throw new Error("Arquivo muito grande. Envie um arquivo de até 25 MB.");
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result.value, fileName: file.name, format: "docx" };
  }

  if (lower.endsWith(".pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    const text = await extractPdfText(arrayBuffer);
    return { text, fileName: file.name, format: "pdf" };
  }

  // Plain text formats
  const text = await file.text();
  const ext = lower.split(".").pop() || "txt";
  return { text, fileName: file.name, format: ext };
}

async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item =>
        "str" in item && typeof item.str === "string" ? item.str : ""
      )
      .filter(Boolean)
      .join(" ");
    pages.push(pageText);
  }

  return pages.join("\n\n");
}
