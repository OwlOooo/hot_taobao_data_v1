import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { database } from './database.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDatabase() {
  try {
    console.log('🔍 检查数据库状态...');

    // 检查数据库文件是否存在且有数据
    const dbPath = config.database.path;
    console.log('📂 数据库路径:', dbPath);

    if (fs.existsSync(dbPath)) {
      console.log('📁 数据库文件已存在，检查表结构...');
      try {
        // 检查是否有表存在
        const result = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'");
        console.log('🔍 查询结果:', result);

        if (result.results && result.results.length > 0) {
          console.log('✅ 数据库已存在且包含数据表，跳过初始化');
          console.log('📊 数据库路径:', dbPath);
          return;
        } else {
          console.log('⚠️  数据库文件存在但缺少必要的表，继续初始化...');
        }
      } catch (error) {
        console.log('⚠️  数据库文件存在但可能损坏，重新初始化...');
        console.log('错误详情:', error.message);
      }
    } else {
      console.log('📝 数据库文件不存在，开始创建...');
    }

    console.log('开始初始化数据库...');

    // 读取SQL文件
    const sqlFile = path.join(__dirname, '../db/init-database.sql');
    if (!fs.existsSync(sqlFile)) {
      console.error('❌ 初始化SQL文件不存在:', sqlFile);
      return;
    }

    const sqlContent = fs.readFileSync(sqlFile, 'utf8');
    
    // 分割SQL语句
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`准备执行 ${statements.length} 条SQL语句...`);

    let successCount = 0;
    let skipCount = 0;

    // 执行每个SQL语句
    for (const statement of statements) {
      try {
        await database.run(statement);
        successCount++;

        // 提取表名或操作类型
        const match = statement.match(/^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX)\s+(\w+)/i);
        if (match) {
          console.log(`✅ ${match[1]}: ${match[2]}`);
        } else {
          console.log('✅ 执行成功:', statement.substring(0, 50) + '...');
        }
      } catch (error) {
        // 忽略表已存在的错误
        if (error.message.includes('already exists')) {
          skipCount++;
          const match = statement.match(/^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX)\s+(\w+)/i);
          if (match) {
            console.log(`⏭️  ${match[1]} ${match[2]} 已存在，跳过`);
          }
        } else {
          console.error('❌ 执行失败:', statement.substring(0, 50) + '...');
          console.error('错误:', error.message);
        }
      }
    }

    console.log(`🎉 数据库初始化完成! 成功: ${successCount}, 跳过: ${skipCount}`);
    
  } catch (error) {
    console.error('数据库初始化失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { initDatabase };
