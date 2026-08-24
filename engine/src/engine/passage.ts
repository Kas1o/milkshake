import type { PassageSource } from '../types.js';

export class Passage {
  readonly title: string;
  readonly tags: string[];
  readonly metadata: Record<string, string>;
  readonly source: string;
  readonly file?: string;

  constructor(src: PassageSource) {
    this.title = src.title;
    this.tags = src.tags ?? [];
    this.metadata = src.metadata ?? {};
    this.source = src.source;
    this.file = src.file;
  }
}
