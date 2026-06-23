declare module 'epub-gen-memory' {
  type EpubContent = {
    title: string;
    content: string;
    author?: string;
    excludeFromToc?: boolean;
    beforeToc?: boolean;
  };

  type EpubOptions = {
    title: string;
    author: string | string[];
    publisher?: string;
    description?: string;
    cover?: string;
    tocTitle?: string;
    appendChapterTitles?: boolean;
    css?: string;
    fonts?: Array<{ filename: string; url: string }>;
    lang?: string;
    verbose?: boolean;
  };

  export class EPub {
    constructor(options: EpubOptions, content: EpubContent[]);
    genEpub(): Promise<Buffer>;
  }
  export default function epub(options: EpubOptions, content: EpubContent[]): Promise<Buffer>;
}
