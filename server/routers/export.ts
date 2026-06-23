import { UserVisibleError } from "@shared/_core/errors";
import { EPub } from 'epub-gen-memory';
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { getChapterById } from '../db';
import { storagePut } from '../storage';
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

function fileSafeName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapPdfLine(value: string, maxChars = 88) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function toPdfTextHex(value: string) {
  const utf16le = Buffer.from(`\ufeff${value || ' '}`, 'utf16le');
  const utf16be = Buffer.alloc(utf16le.length);
  for (let i = 0; i < utf16le.length; i += 2) {
    utf16be[i] = utf16le[i + 1] ?? 0;
    utf16be[i + 1] = utf16le[i] ?? 0;
  }
  return `<${utf16be.toString('hex').toUpperCase()}>`;
}

function buildPdfBuffer(title: string, body: string) {
  const paragraphs = body.split(/\r?\n/);
  const lines = [
    ...wrapPdfLine(title || 'Capítulo sem título', 76),
    '',
    ...paragraphs.flatMap((paragraph) => wrapPdfLine(paragraph)),
  ];
  const linesPerPage = 42;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  addObject('');
  addObject(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  for (const pageLines of pages) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);

    const stream = [
      'BT',
      '/F1 12 Tf',
      '15 TL',
      '50 760 Td',
      ...pageLines.flatMap((line, index) => [
        index === 0 ? '' : 'T*',
        `${toPdfTextHex(line)} Tj`,
      ]).filter(Boolean),
      'ET',
    ].join('\n');

    addObject(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentId} 0 R >>\nendobj\n`);
    addObject(`${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }

  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf-8');
}

async function chapterToDocBuffer(title: string, content: string) {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { after: 300 } })];
  for (const block of content.split(/\n+/).filter(Boolean)) {
    children.push(new Paragraph({ children: [new TextRun(block)], spacing: { after: 200 } }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export const exportRouter = router({
  toDOCX: protectedProcedure.input(z.object({ chapterId: z.number() })).mutation(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const buffer = await chapterToDocBuffer(chapter.title, chapter.content);
    const fileName = `${fileSafeName(chapter.title)}-${Date.now()}.docx`;
    const { url } = await storagePut(`exports/${ctx.user!.id}/chapters/${fileName}`, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return { success: true, downloadUrl: url, fileName, format: 'docx' };
  }),

  toPDF: protectedProcedure.input(z.object({ chapterId: z.number() })).mutation(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const fileName = `${fileSafeName(chapter.title)}-${Date.now()}.pdf`;
    const { url } = await storagePut(`exports/${ctx.user!.id}/chapters/${fileName}`, buildPdfBuffer(chapter.title, chapter.content), 'application/pdf');
    return { success: true, downloadUrl: url, fileName, format: 'pdf' };
  }),

  toEPUB: protectedProcedure.input(z.object({ chapterId: z.number() })).mutation(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    // A06 (OWASP) — `epub-gen-memory` substitui o `epub-gen` (abandonado em
    // 2017 e com deps transitivas vulneráveis). Constrói o EPUB direto na
    // memória, sem arquivo temporário.
    const ebook = new EPub(
      {
        title: chapter.title,
        author: ctx.user.name || 'Autor',
        lang: 'pt',
      },
      [
        {
          title: chapter.title,
          content: `<h1>${escapeHtml(chapter.title)}</h1>${chapter.content.split(/\n+/).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}`,
        },
      ],
    );
    const buffer = await ebook.genEpub();
    const fileName = `${fileSafeName(chapter.title)}-${Date.now()}.epub`;
    const { url } = await storagePut(`exports/${ctx.user!.id}/chapters/${fileName}`, buffer, 'application/epub+zip');
    return { success: true, downloadUrl: url, fileName, format: 'epub' };
  }),

  multipleChaptersToDOCX: protectedProcedure.input(z.object({ chapterIds: z.array(z.number()).min(1), bookTitle: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const chapters = [] as Array<{ title: string; content: string }>;
    for (const chapterId of input.chapterIds) {
      const chapter = await getChapterById(chapterId, ctx.user!.id, ctx.activeWorkId);
      if (!chapter) throw new UserVisibleError(`Capítulo ${chapterId} não encontrado.`);
      chapters.push({ title: chapter.title, content: chapter.content });
    }

    const children = [new Paragraph({ text: input.bookTitle, heading: HeadingLevel.TITLE, spacing: { after: 500 } })];
    for (const chapter of chapters) {
      children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }));
      for (const block of chapter.content.split(/\n+/).filter(Boolean)) {
        children.push(new Paragraph({ children: [new TextRun(block)], spacing: { after: 200 } }));
      }
    }
    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    const fileName = `${fileSafeName(input.bookTitle)}-${Date.now()}.docx`;
    const { url } = await storagePut(`exports/${ctx.user!.id}/books/${fileName}`, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return { success: true, downloadUrl: url, fileName, format: 'docx' };
  }),
});
