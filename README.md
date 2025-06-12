# 淘宝订单管理系统 (Node.js版本)

这是一个从Cloudflare Worker迁移到Node.js的淘宝订单管理系统，使用SQLite作为数据库。

## 功能特性

- 多主播订单数据同步
- 自动定时任务
- 报表统计生成
- 钉钉通知集成
- Web管理界面

## 快速开始

### 一键启动（推荐）

```bash
npm run setup
```

这个命令会自动：
1. 安装依赖
2. 复制环境变量模板
3. 初始化数据库
4. 启动服务器

### 手动安装

1. **安装依赖**
```bash
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
```
编辑 `.env` 文件，配置以下参数：
- `TAOBAO_COOKIES`: 淘宝登录Cookie
- `DING_KEY`: 钉钉机器人密钥
- `CSRF_TOKEN`: 淘宝API的CSRF令牌

3. **初始化数据库**
```bash
npm run init-db
```

## 使用方法

### 启动服务器

```bash
npm start
```

服务器将在 http://localhost:3000 启动

### 开发模式

```bash
npm run dev
```

### 手动执行任务

```bash
npm run job
```

### 项目维护

```bash
npm run clean    # 清理临时文件和缓存
npm run check    # 检查项目结构完整性
```

## API接口

### 触发同步任务
```
GET /trigger
```

### 单个主播同步
```
POST /sync-anchor
Content-Type: application/json

{
  "anchorId": "主播ID",
  "startTime": "20250120 00:00:00",  // 可选
  "endTime": "20250120 23:59:59"     // 可选
}
```

### 数据查询接口
```
GET /api/orders          # 获取订单数据
GET /api/stats           # 获取统计数据
GET /api/export          # 导出订单数据
GET /api/sellers         # 获取商家列表
GET /api/anchors         # 获取主播列表
GET /api/anchors/list    # 获取主播详细列表
GET /api/sync-logs       # 获取同步日志
GET /api/reports         # 获取报表数据
```

### 主播管理接口
```
POST /api/anchors        # 添加主播
GET /api/anchors/:id     # 获取单个主播
PUT /api/anchors/:id     # 更新主播
DELETE /api/anchors/:id  # 删除主播
```

### 健康检查
```
GET /health
```

### 认证
所有API接口都需要在请求头中包含API密钥：
```
X-API-Key: your_api_key_here
```

## 项目结构

```
hot-taobao-job-admin-v3/
├── src/                    # 源代码目录
│   ├── server.js          # Express服务器入口
│   ├── index.js           # API路由定义
│   ├── job.js             # 任务处理逻辑
│   ├── config.js          # 配置管理
│   ├── database.js        # 数据库操作封装
│   ├── init-db.js         # 数据库初始化
│   └── run-job.js         # 独立任务执行
├── public/                 # 静态文件目录
│   ├── order.html         # 订单管理页面
│   ├── anchors.html       # 主播管理页面
│   ├── reports.html       # 报表页面
│   └── sync-logs.html     # 同步日志页面
├── scripts/                # 工具脚本目录
│   └── clean.js           # 项目清理脚本
├── data/                   # 数据库文件目录（自动创建）
├── database.sql           # 数据库结构定义
├── package.json           # 项目依赖配置
├── start.js               # 一键启动脚本
├── .env                   # 环境变量配置
└── README.md              # 项目说明
```

## Web界面

- 主页: http://localhost:3000/
- 主播管理: http://localhost:3000/anchors
- 报表查看: http://localhost:3000/reports
- 同步日志: http://localhost:3000/sync-logs

## 定时任务

系统默认每天凌晨2点自动执行同步任务，可通过环境变量 `CRON_SCHEDULE` 修改。

## 数据库

使用SQLite数据库，数据文件默认保存在 `./db/hot-taobao-data.db`

主要表结构：
- `orders`: 订单数据
- `anchors`: 主播信息
- `sync_logs`: 同步日志
- `reports`: 报表统计

## 注意事项

1. 确保淘宝Cookie有效
2. 定期检查同步日志
3. 备份数据库文件
4. 监控系统资源使用情况
