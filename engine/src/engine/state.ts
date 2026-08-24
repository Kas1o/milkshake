import type { Vars } from '../types.js';

export class StoryState<T extends object = Vars> {
  variables: T;
  history: string[] = [];
  visits: Map<string, number> = new Map();
  turns = 0;
  current?: string;
  previous?: string;

  constructor(variables: T = {} as T) {
    this.variables = variables;
  }

  recordEnter(name: string) {
    this.previous = this.current;
    this.current = name;
    this.history.push(name);
    this.turns++;
    this.visits.set(name, (this.visits.get(name) ?? 0) + 1);
  }

  visited(name: string): number {
    return this.visits.get(name) ?? 0;
  }
}
