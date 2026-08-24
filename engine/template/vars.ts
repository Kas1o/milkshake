/**
 * 故事变量的唯一声明处（类型 + 默认值）。
 * 引擎会在开局与「重新开始」时深拷贝这里的默认值；
 * 向未在此声明的变量赋值会直接报错。
 */

export interface StoryVars {
  name: string;
  gold: number;
  hp: number;
  maxhp: number;
  day: number;
}

const defaultVars: StoryVars = {
  name: '',
  gold: 12,
  hp: 100,
  maxhp: 100,
  day: 1,
};

export default defaultVars;
