# 数据库文件目录

## 使用说明

请将您的 `hot-taobao-data.db` 文件放在此目录下。

## 文件结构

```
db/
├── README.md           # 本说明文件
├── .gitkeep           # 保持目录在版本控制中
└── hot-taobao-data.db # 您的数据库文件（请手动放置）
```

## 注意事项

1. **数据库文件名**：必须是 `hot-taobao-data.db`
2. **文件位置**：必须放在 `db/` 目录下
3. **版本控制**：数据库文件会被 `.gitignore` 忽略，不会提交到版本控制
4. **自动创建**：如果文件不存在，SQLite会在首次运行时自动创建空数据库

## 配置

数据库路径在以下文件中配置：
- `.env`: `DB_PATH=./db/hot-taobao-data.db`
- `src/config.js`: 默认路径配置
