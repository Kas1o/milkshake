/**
 * The untyped shape of story variables.
 * Generic parameters are constrained to `object` instead so that author
 * interfaces (which lack an implicit index signature) also satisfy them.
 */
export type Vars = Record<string, unknown>;

export interface StoryOptions<T extends object = Vars> {
  name?: string;
  start?: string;
  transpile?: boolean;
  /** Stable per-story identifier (from story.config.ts) for namespacing e.g. saves. */
  uid?: string;
  /** Default story variables; cloned into state on start and reset. */
  vars?: T;
}

export interface PassageSource {
  title: string;
  source: string;
  tags: string[];
  metadata: Record<string, string>;
  file?: string;
  /** 0-based line of the `:: Title` header within `file`. */
  line?: number;
}

export interface CondBranch {
  test?: string;
  nodes: Node[];
}

export type Node =
  | { kind: 'text'; text: string }
  | { kind: 'macro'; name: string; args: string; content?: Node[]; branches?: CondBranch[] }
  | { kind: 'interp'; expr: string }
  | { kind: 'link'; label: string; target: string; setup?: string };

export interface Link {
  id: string;
  kind: 'link' | 'button';
  label: string;
  target?: string;
  setup?: string;
  captured?: Record<string, unknown>;
}

/** A block of raw HTML a macro wants inserted verbatim into the rendered body
 * (bypassing the markdown escaping that normal macro output goes through).
 * Used by interact-style macros to embed live form controls inline. */
export interface Embed {
  id: string;
  html: string;
}

export interface RenderResult {
  passage: string;
  text: string;
  links: Link[];
  embeds: Embed[];
}
