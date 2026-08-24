import type { StoryContext } from '../../engine/src/index.js';
import type { StoryVars } from '../vars.js';

export function install(ctx: StoryContext<StoryVars>) {
  ctx.registerHelper('dice', (n?: number) => Math.floor(Math.random() * (n ?? 6)) + 1);
  ctx.registerHelper('coin', () => Math.random() < 0.5);
  ctx.registerHelper('hasItem', (name: string) => ctx.variables.inventory.includes(name));
  ctx.registerHelper('status', () => {
    const v = ctx.variables;
    return `**金币** ${v.gold} · **体力** ${v.hp}/${v.maxhp} · **第 ${v.day} 天**`;
  });
}
