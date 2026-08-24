import type { StoryContext } from '../../engine/src/index.js';
import type { StoryVars } from '../vars.js';

export function install(ctx: StoryContext<StoryVars>) {
  ctx.on('passage:after', ({ result }: any) => {
    if (ctx.variables.hp < 20 && result.text) {
      result.text += `\n\n> 你感觉有些虚弱……（体力不足 20）`;
    }
  });
}
