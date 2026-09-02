import type { InfraModule } from '../../src/web/infra.js';

/**
 * 「流程控制」基础设施模块。
 * 安装后拷入 scripts/flow-macros.ts，提供一组流程 / 状态宏：
 *   - <<visitOnce>>          块内容整局只渲染一次
 *   - <<ifVisited>> / <<ifNotVisited>>   按段落访问次数分支
 *   - <<counter>> / <<resetCounter>>     具名计数器
 *   - count(name) 助手
 * 状态存于 variables._flow 保留命名空间，随存档持久化、重新开始时清零。
 * 纯逻辑无 UI，无需补丁。
 */
const module: InfraModule = {
  id: 'flow',
  label: '流程控制',
  description: 'visitOnce / counter / ifVisited 等流程状态宏与 count 助手。',

  files: ['scripts/flow-macros.ts'],
};

export default module;
