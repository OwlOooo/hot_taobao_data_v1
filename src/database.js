import Database from 'better-sqlite3';
import { config } from './config.js';
import path from 'path';
import fs from 'fs';

// 确保db目录存在
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建数据库连接
let db;
try {
  db = new Database(config.database.path);
  console.log('数据库连接成功:', config.database.path);
} catch (err) {
  console.error('数据库连接失败:', err.message);
  process.exit(1);
}

// 启用外键约束
db.exec("PRAGMA foreign_keys = ON");

// 数据库操作封装类
export class DatabaseWrapper {
  constructor() {
    this.db = db;
  }

  // 检查数据库连接是否有效
  isOpen() {
    return this.db && this.db.open;
  }

  // 重新连接数据库
  reconnect() {
    if (!this.isOpen()) {
      try {
        this.db = new Database(config.database.path);
        console.log('数据库重新连接成功');
      } catch (err) {
        console.error('数据库重新连接失败:', err.message);
        throw err;
      }
    }
  }

  // 执行查询
  async all(sql, params = []) {
    try {
      if (!this.isOpen()) {
        this.reconnect();
      }
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(params);
      return { results: rows };
    } catch (err) {
      throw err;
    }
  }

  // 执行单条查询
  async get(sql, params = []) {
    try {
      if (!this.isOpen()) {
        this.reconnect();
      }
      const stmt = this.db.prepare(sql);
      return stmt.get(params);
    } catch (err) {
      throw err;
    }
  }

  // 执行插入/更新/删除
  async run(sql, params = []) {
    try {
      if (!this.isOpen()) {
        this.reconnect();
      }
      const stmt = this.db.prepare(sql);
      const result = stmt.run(params);
      return {
        success: true,
        meta: {
          last_row_id: result.lastInsertRowid,
          changes: result.changes
        }
      };
    } catch (err) {
      throw err;
    }
  }

  // 批量执行
  async batch(statements) {
    if (!this.isOpen()) {
      this.reconnect();
    }

    const transaction = this.db.transaction(() => {
      const results = [];

      for (const stmt of statements) {
        try {
          const result = stmt.run();
          results.push({
            success: true,
            meta: {
              last_row_id: result.lastInsertRowid,
              changes: result.changes
            }
          });
        } catch (err) {
          results.push({ success: false, error: err.message });
        }
      }

      return results;
    });

    try {
      return transaction();
    } catch (err) {
      throw err;
    }
  }

  // 准备语句
  prepare(sql) {
    if (!this.isOpen()) {
      this.reconnect();
    }

    const stmt = this.db.prepare(sql);
    return {
      bind: (...params) => ({
        run: () => this.run(sql, params),
        all: () => this.all(sql, params),
        get: () => this.get(sql, params)
      }),
      run: (params = []) => this.run(sql, params),
      all: (params = []) => this.all(sql, params),
      get: (params = []) => this.get(sql, params)
    };
  }

  // 关闭数据库连接（谨慎使用，可能影响其他模块）
  close() {
    try {
      if (this.isOpen()) {
        this.db.close();
        console.log('数据库连接已关闭');
      }
      return Promise.resolve();
    } catch (err) {
      console.error('关闭数据库连接失败:', err.message);
      return Promise.reject(err);
    }
  }
}

// 导出数据库实例
export const database = new DatabaseWrapper();

export default database;
