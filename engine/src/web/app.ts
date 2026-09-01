import { Engine, makeContext } from '../engine/engine.js';
import type { RenderResult, Vars } from '../types.js';
import { mdToHtml, inlineLinksToHtml } from './md.js';

/** Navigation / rendering helpers handed to a layout. */
export interface StoryController {
  engine: Engine;
  /** Convert story text (lightweight Markdown) to HTML. */
  md(md: string): string;
  /** Consume pending navigations and paint the current passage. */
  advance(): Promise<void>;
  /** Reset and restart the story, then paint the start passage. */
  restart(): Promise<void>;
  /** Follow a rendered link / button and paint the result. */
  choose(id: string): Promise<void>;
  /** Render inline link placeholders into clickable anchors (call on the body HTML). */
  inlineLinks(html: string, result: RenderResult): string;
  /** Wire click handlers to anchors produced by inlineLinks. */
  bindLinks(root: ParentNode, result: RenderResult): void;
}

/**
 * A pluggable page layout. Story projects provide their own via `layout.ts`
 * (see the project template); `runStory` falls back to a minimal built-in.
 */
export interface StoryLayout {
  /** Called once to build the page skeleton and wire controls. */
  init(ctrl: StoryController): void;
  /** Called after every render to paint a passage into the DOM. */
  render(ctrl: StoryController, result: RenderResult): Promise<void> | void;
}

export interface StoryBundle {
  title?: string;
  start?: string;
  uid?: string;
  vars?: Vars;
  passages: import('../types.js').PassageSource[];
  install: (ctx: ReturnType<typeof makeContext>) => Promise<void>;
  layout?: StoryLayout;
}

const defaultLayout: StoryLayout = {
  init() {
    document.body.innerHTML = '<main id="story"><div id="passages"></div></main>';
  },
  render(ctrl, result) {
    const el = document.getElementById('passages')!;
    const div = document.createElement('div');
    div.className = 'passage';
    div.innerHTML = ctrl.inlineLinks(mdToHtml(result.text), result);
    ctrl.bindLinks(div, result);
    el.appendChild(div);
    window.scrollTo({ top: 0 });
  },
};

export async function runStory(bundle: StoryBundle): Promise<void> {
  const engine = new Engine({
    name: bundle.title ?? 'Milkshake Story',
    start: bundle.start ?? 'Start',
    uid: bundle.uid,
    vars: bundle.vars,
  });
  engine.ask = async prompt => window.prompt(prompt) ?? '';
  const ctx = makeContext(engine);
  await bundle.install(ctx);
  engine.loadPassages(bundle.passages);

  const layout = bundle.layout ?? defaultLayout;
  let current: RenderResult | null = null;
  let ctrl: StoryController;

  // Serialize navigation so fast clicks can't trigger overlapping renders,
  // which is what produces duplicated passages.
  let busy = false;
  const guard =
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        await fn(...args);
      } finally {
        busy = false;
      }
    };

  const showError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const el = document.getElementById('passages')!;
    const div = document.createElement('div');
    div.className = 'passage passage-in engine-error';
    div.innerHTML = `<h2>⚠️ 运行时错误</h2><pre></pre>`;
    (div.querySelector('pre') as HTMLElement).textContent = msg;
    el.appendChild(div);
    console.error(err);
  };

  const rawAdvance = async () => {
    try {
      let guardCount = 0;
      while (engine.pendingNav) {
        if (++guardCount > 200) break;
        current = (await engine.consumePendingNav())!;
      }
      if (!current) current = await engine.renderCurrent();
      await layout.render(ctrl, current);
    } catch (err) {
      // Surface runtime errors (unknown macro, bad expression, ...) instead
      // of freezing the page with no feedback.
      showError(err);
    }
  };
  const advance = guard(rawAdvance);

  ctrl = {
    engine,
    md: mdToHtml,
    advance,
    inlineLinks: (html, result) =>
      inlineLinksToHtml(html, id => result.links.find(l => l.id === id)),
    bindLinks: (root, result) => {
      root.querySelectorAll('a.link[data-link]').forEach(a => {
        a.addEventListener('click', ev => {
          ev.preventDefault();
          const id = a.getAttribute('data-link');
          if (id) ctrl.choose(id);
        });
      });
    },
    restart: guard(async () => {
      engine.reset();
      current = await engine.start();
      await rawAdvance();
    }),
    choose: guard(async id => {
      current = (await engine.choose(id)) ?? current;
      await rawAdvance();
    }),
  };

  layout.init(ctrl);
  current = await engine.start();
  await advance();
}
