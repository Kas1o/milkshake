/**
 * 故事变量的唯一声明处（类型 + 默认值）。
 * 引擎会在开局与「重新开始」时深拷贝这里的默认值；
 * 向未在此声明的变量赋值会直接报错。
 */

export interface Drink {
  name: string;
  price: number;
  heal: number;
}

export interface StoryFlags {
  quest?: string;
  inBattle?: boolean;
  bossDefeated?: boolean;
  bought?: boolean;
  notEnough?: boolean;
  noMilk?: boolean;
}

export interface StoryVars {
  name: string;
  gold: number;
  hp: number;
  maxhp: number;
  day: number;
  inventory: string[];
  flags: StoryFlags;
  enemyName: string;
  enemyHp: number;
  enemyGold: number;
  lastTip: number;
  roll: number;
  drinks: Drink[];
}

const defaultVars: StoryVars = {
  name: '',
  gold: 12,
  hp: 100,
  maxhp: 100,
  day: 1,
  inventory: [],
  flags: {},
  enemyName: '',
  enemyHp: 0,
  enemyGold: 0,
  lastTip: 0,
  roll: 0,
  drinks: [
    { name: '牛奶', price: 5, heal: 20 },
    { name: '香蕉奶昔', price: 9, heal: 40 },
    { name: '草莓星冰乐', price: 15, heal: 60 },
  ],
};

export default defaultVars;
