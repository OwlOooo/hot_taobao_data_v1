import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  // 服务器配置
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost'
  },

  // 数据库配置
  database: {
    path: process.env.DB_PATH || path.join(__dirname, '../db/hot-taobao-data.db')
  },

  // 系统访问密码
  auth: {
    password: process.env.PASSWORD || '123456'
  },

  // API配置
  api: {
    baseUrl: "https://hot.taobao.com/wallet/getPredictOrder.do",
    defaultCsrf: process.env.CSRF_TOKEN || '5843ca0f-7aec-474a-bf9d-4106a41960e2',
    pageSize: 100,
    maxPages: 50,
    batchSize: 3,
    dbBatchSize: 50,
    batchDelay: 500
  },

  // 钉钉配置
  dingtalk: {
    key: process.env.DING_KEY || ''
  },

  // 定时任务配置
  cron: {
    // 从早上6点到24点，每小时的第10分和40分执行
    schedule: process.env.CRON_SCHEDULE || '10,40 6-23 * * *'
  }
};
