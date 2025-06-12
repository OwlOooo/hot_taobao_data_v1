import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase } from './init-db.js';
import { runScheduledJob, triggerJob, syncSingleAnchor } from './job.js';
import apiRoutes from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 使用API路由
app.use('/', apiRoutes);

// 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/order.html'));
});

app.get('/anchors', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/anchors.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reports.html'));
});

app.get('/sync-logs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/sync-logs.html'));
});

// 额外的API路由（不在index.js中的）
app.get('/trigger', async (req, res) => {
  try {
    const result = await triggerJob();
    res.json(result);
  } catch (error) {
    console.error('触发任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库
    console.log('初始化数据库...');
    await initDatabase();
    
    // 启动HTTP服务器
    app.listen(config.server.port, config.server.host, () => {
      console.log(`服务器启动成功: http://${config.server.host}:${config.server.port}`);
      console.log(`管理界面: http://${config.server.host}:${config.server.port}/anchors`);
    });
    
    // 启动定时任务
    console.log(`设置定时任务: ${config.cron.schedule}`);
    cron.schedule(config.cron.schedule, async () => {
      console.log('定时任务开始执行...');
      try {
        await runScheduledJob();
        console.log('定时任务执行完成');
      } catch (error) {
        console.error('定时任务执行失败:', error);
      }
    }, {
      timezone: "Asia/Shanghai"
    });
    
    console.log('系统启动完成!');
    
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...');
  process.exit(0);
});

// 启动应用
startServer();
