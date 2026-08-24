export { Engine, random, makeContext, type StoryContext } from './engine/engine.js';
export { loadProject, loadVars, walk, parsePassageFile, parseHeader, loadConfig, importTsFile } from './engine/story.js';
export { parseNodes, splitArgs } from './engine/parser.js';
export { createScope, evalExpression, runStatements, transpileTS } from './engine/expr.js';
export { mdToHtml, inlineLinksToHtml, escapeHtml } from './web/md.js';
export type { StoryLayout, StoryController, StoryBundle } from './web/app.js';
export type { MacroContext, MacroDef } from './engine/macros.js';
export type {
  Node,
  Link,
  RenderResult,
  CondBranch,
  PassageSource,
  StoryOptions,
  Vars,
} from './types.js';

import { Engine } from './engine/engine.js';
import type { StoryOptions, Vars } from './types.js';

export function createEngine<T extends object = Vars>(options: StoryOptions<T> = {}): Engine<T> {
  return new Engine(options);
}
