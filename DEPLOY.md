# 热淘宝任务管理系统 - Debian服务器部署指南

## 快速部署

### 1. 上传项目文件
将整个项目文件夹上传到Debian服务器

### 2. 运行部署脚本
```bash
# 添加执行权限
chmod +x deploy.sh

# 运行部署脚本（需要root权限）
sudo ./deploy.sh
```

### 3. 选择"全新部署"
在菜单中选择选项 `1) 全新部署 (首次安装)`

## 部署脚本功能

### 🚀 部署管理
- **全新部署**: 自动安装所有依赖，配置环境，部署项目
- **更新项目**: 更新代码和依赖，重启服务
- **卸载服务**: 完全删除服务和数据

### 🔧 服务管理
- **启动服务**: 启动应用服务
- **停止服务**: 停止应用服务
- **重启服务**: 重启应用服务
- **查看状态**: 显示服务运行状态和详细信息

### 📋 日志管理
- **查看日志**: 实时日志、历史日志、错误日志
- **清理日志**: 清理所有日志文件

### 📊 系统信息
- **显示系统信息**: 查看系统版本、Node.js版本等
- **测试服务连接**: 检查服务是否正常运行

## 自动安装的组件

### 系统依赖
- Node.js 18.x
- PM2 (进程管理器)
- SQLite3
- 构建工具 (build-essential)

### 项目配置
- 项目目录: `/opt/hot-taobao-job-admin`
- 日志目录: `/var/log/hot-taobao-job-admin`
- 运行用户: `www-data`
- 服务端口: `3000`

## 服务访问

部署完成后，可以通过以下地址访问：

- **主页**: `http://服务器IP:3000`
- **管理界面**: `http://服务器IP:3000/anchors`
- **健康检查**: `http://服务器IP:3000/health`
- **手动触发**: `http://服务器IP:3000/trigger`

## 默认配置

- **系统密码**: `123456`
- **定时任务**: 每小时的10分和40分执行（6:00-23:40）
- **数据库**: SQLite，自动初始化

## 常用命令

### 手动管理服务
```bash
# 查看服务状态
sudo -u www-data pm2 status

# 查看实时日志
sudo -u www-data pm2 logs hot-taobao

# 重启服务
sudo -u www-data pm2 restart hot-taobao

# 停止服务
sudo -u www-data pm2 stop hot-taobao
```

### 查看日志文件
```bash
# 查看错误日志
tail -f /var/log/hot-taobao-job-admin/error.log

# 查看输出日志
tail -f /var/log/hot-taobao-job-admin/out.log

# 查看合并日志
tail -f /var/log/hot-taobao-job-admin/combined.log
```

## 防火墙配置

如果服务器启用了防火墙，需要开放3000端口：

```bash
# UFW防火墙
sudo ufw allow 3000

# iptables防火墙
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

## 故障排除

### 1. 服务无法启动
- 检查Node.js是否正确安装: `node --version`
- 检查PM2是否正确安装: `pm2 --version`
- 查看错误日志: `sudo -u www-data pm2 logs hot-taobao --err`

### 2. 端口被占用
```bash
# 查看端口占用
sudo netstat -tlnp | grep :3000

# 杀死占用进程
sudo kill -9 <PID>
```

### 3. 权限问题
```bash
# 修复项目目录权限
sudo chown -R www-data:www-data /opt/hot-taobao-job-admin

# 修复日志目录权限
sudo chown -R www-data:www-data /var/log/hot-taobao-job-admin
```

### 4. 数据库问题
```bash
# 重新初始化数据库
cd /opt/hot-taobao-job-admin
sudo -u www-data npm run init-db
```

## 更新项目

### 方法1: 使用部署脚本
```bash
sudo ./deploy.sh
# 选择 "2) 更新项目"
```

### 方法2: 手动更新
```bash
# 停止服务
sudo -u www-data pm2 stop hot-taobao

# 更新代码（如果是git仓库）
cd /opt/hot-taobao-job-admin
sudo -u www-data git pull

# 更新依赖
sudo -u www-data npm install

# 重启服务
sudo -u www-data pm2 restart hot-taobao
```

## 备份和恢复

### 备份数据库
```bash
cp /opt/hot-taobao-job-admin/db/hot-taobao-data.db /backup/
```

### 恢复数据库
```bash
cp /backup/hot-taobao-data.db /opt/hot-taobao-job-admin/db/
sudo chown www-data:www-data /opt/hot-taobao-job-admin/db/hot-taobao-data.db
```

## 开机自启

PM2会自动配置开机自启，如果需要手动配置：

```bash
# 保存PM2进程列表
sudo -u www-data pm2 save

# 生成启动脚本
sudo pm2 startup systemd -u www-data --hp /home/www-data

# 启用服务
sudo systemctl enable pm2-www-data
```
