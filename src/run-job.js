#!/usr/bin/env node

import { runScheduledJob } from './job.js';

// 运行定时任务
async function main() {
  try {
    console.log('开始执行任务...');
    await runScheduledJob();
    console.log('任务执行完成');
    process.exit(0);
  } catch (error) {
    console.error('任务执行失败:', error);
    process.exit(1);
  }
}

main();
