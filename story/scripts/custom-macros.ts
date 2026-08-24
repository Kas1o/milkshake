import type { StoryContext } from '../../engine/src/index.js';
import type { StoryVars } from '../vars.js';

interface BattleResult {
  victory: boolean;
  playerHpAfter: number;
  goldGained: number;
}

/**
 * 阻塞式旁路战斗弹窗：完全由页面侧绘制并驱动，引擎不参与战斗过程。
 * 返回的 Promise 在玩家关闭弹窗后 resolve；渲染管线会一直挂起等待（宏的
 * run 在 engine.ts 中被 await），结果由调用方写回故事上下文。
 *
 * 注意：DOM 访问必须放在函数内部——Node 侧（npm run check / loadProject）
 * 会用 importTsFile 在无 DOM 环境 import 本脚本，顶层碰 document 会崩。
 */
function openBattleModal(config: {
  enemy: string;
  enemyHp: number;
  enemyGold: number;
  playerHp: number;
  playerMaxHp: number;
}): Promise<BattleResult> {
  return new Promise(resolve => {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    let result: BattleResult = {
      victory: false,
      playerHpAfter: config.playerHp,
      goldGained: 0,
    };

    const overlay = document.createElement('div');
    overlay.className = 'battle-overlay';
    const box = document.createElement('div');
    box.className = 'battle-window';

    const title = document.createElement('div');
    title.className = 'battle-enemy';
    title.textContent = `⚔️ ${config.enemy}`;

    function makeBar(label: string, max: number) {
      const wrap = document.createElement('div');
      wrap.className = 'battle-bar';
      const lab = document.createElement('span');
      lab.className = 'battle-bar-label';
      const fill = document.createElement('div');
      fill.className = 'battle-bar-fill';
      wrap.append(lab, fill);
      box.appendChild(wrap);
      return {
        set(hp: number) {
          lab.textContent = `${label} ${Math.max(0, hp)}/${max}`;
          fill.style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
        },
      };
    }
    const enemyBar = makeBar('敌方', config.enemyHp);
    const playerBar = makeBar('你', config.playerMaxHp);

    const log = document.createElement('div');
    log.className = 'battle-log';
    const write = (msg: string) => {
      const line = document.createElement('div');
      line.textContent = msg;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    };

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'battle-close';
    closeBtn.textContent = '关闭';
    closeBtn.style.display = 'none';
    closeBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(result);
    });

    box.append(title, log, closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    enemyBar.set(config.enemyHp);
    playerBar.set(config.playerHp);

    (async () => {
      let eh = config.enemyHp;
      let ph = config.playerHp;
      while (eh > 0 && ph > 0) {
        await sleep(450);
        const dmg = 3 + Math.floor(Math.random() * 8);
        eh = Math.max(0, eh - dmg);
        write(`你攻击${config.enemy}，造成 ${dmg} 点伤害。`);
        enemyBar.set(eh);
        if (eh <= 0) break;
        await sleep(450);
        const edmg = 2 + Math.floor(Math.random() * 6);
        ph = Math.max(0, ph - edmg);
        write(`${config.enemy} 攻击你，造成 ${edmg} 点伤害。`);
        playerBar.set(ph);
      }
      result = {
        victory: eh <= 0,
        playerHpAfter: ph,
        goldGained: eh <= 0 ? config.enemyGold : 0,
      };
      write(result.victory ? '🎉 战斗胜利！' : '💀 你倒下了……');
      closeBtn.style.display = '';
    })();
  });
}

export function install(ctx: StoryContext<StoryVars>) {
  ctx.registerMacro({
    name: 'heal',
    run: c => {
      const v = ctx.variables;
      v.hp = Math.min(v.hp + Number(c.eval(c.args) || 0), v.maxhp);
      return `\n体力恢复，当前 ${v.hp}/${v.maxhp}。`;
    },
  });

  ctx.registerMacro({
    name: 'quest',
    run: c => {
      const goal = c.evalStr(c.args);
      ctx.variables.flags.quest = goal;
      return `📜 新目标：**${goal}**`;
    },
  });

  ctx.registerMacro({
    name: 'enemy',
    block: true,
    run: async c => {
      const toks = c.args.trim().split(/\s+/);
      const name = c.evalStr(toks[0] ?? '""');
      const hp = Number(c.eval(toks[1] ?? '0'));
      const gold = Number(c.eval(toks[2] ?? '0'));
      const v = ctx.variables;
      v.enemyName = name;
      if (!v.flags.inBattle) {
        v.flags.inBattle = true;
        v.enemyHp = hp;
        v.enemyGold = gold;
      }
      return `⚔️ **${name}** 挡住了去路（体力 ${v.enemyHp}，掉落 ${v.enemyGold || gold} 金币）！\n${await c.render(c.content ?? [])}`;
    },
  });

  ctx.registerMacro({
    name: 'prompt',
    run: async c => {
      const ask = c.engine.ask;
      if (!ask) throw new Error('<<prompt>> requires engine.ask (set it in the host application)');
      const ans = await ask(c.evalStr(c.args) + ' ');
      ctx.variables.name = ans.trim();
      return '';
    },
  });

  ctx.registerMacro({
    name: 'battle',
    run: async c => {
      // 阻塞式旁路战斗：弹窗自己跑完，结果写回上下文。
      const spec = c.eval(c.args) as { enemy: string; hp: number; gold: number };
      const v = ctx.variables;
      const res = await openBattleModal({
        enemy: spec.enemy,
        enemyHp: spec.hp,
        enemyGold: spec.gold,
        playerHp: v.hp,
        playerMaxHp: v.maxhp,
      });
      v.hp = Math.max(res.playerHpAfter, 0);
      if (!res.victory) return `💀 你被 **${spec.enemy}** 击败了……`;
      v.gold += res.goldGained;
      return `⚔️ 你击败了 **${spec.enemy}**，获得 ${res.goldGained} 金币！`;
    },
  });
}
