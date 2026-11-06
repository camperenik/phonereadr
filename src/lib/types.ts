export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'li';

/** Satu blok teks hasil reflow. `page` = nomor halaman/bab/bagian asal. */
export interface Block {
  type: BlockType;
  text: string;
  page: number;
}

export type Format = 'pdf' | 'txt' | 'epub' | 'docx' | 'md';

export interface ParsedDoc {
  blocks: Block[];
  pages: number;
  title?: string;
}
