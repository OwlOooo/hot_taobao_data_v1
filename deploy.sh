#!/bin/bash

# 热淘宝任务管理系统 - 一键部署脚本
# 适用于 Debian/Ubuntu 服务器

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目配置
PROJECT_NAME="hot-taobao-job-admin"
PROJECT_DIR="/opt/$PROJECT_NAME"
SERVICE_NAME="hot-taobao"
LOG_DIR="/var/log/$PROJECT_NAME"
USER="www-data"
GIT_REPO="https://github.com/OwlOooo/hot_taobao_data_v1.git"
GIT_BRANCH="main"

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为root用户
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "此脚本需要root权限运行"
        echo "请使用: sudo $0"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    print_info "更新系统包..."
    apt update

    print_info "安装必要依赖..."
    apt install -y curl wget git build-essential python3 sqlite3

    # 安装 Node.js 18.x
    if ! command -v node &> /dev/null; then
        print_info "安装 Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt install -y nodejs
    fi

    # 安装 PM2
    if ! command -v pm2 &> /dev/null; then
        print_info "安装 PM2..."
        npm install -g pm2
    fi

    print_success "依赖安装完成"
}

# 创建项目目录和用户
setup_project() {
    print_info "创建项目目录..."
    mkdir -p $PROJECT_DIR
    mkdir -p $LOG_DIR

    # 创建用户（如果不存在）
    if ! id "$USER" &>/dev/null; then
        print_info "创建用户 $USER..."
        useradd -r -s /bin/false $USER
    fi

    # 设置目录权限
    chown -R $USER:$USER $PROJECT_DIR
    chown -R $USER:$USER $LOG_DIR
    chmod 755 $PROJECT_DIR
    chmod 755 $LOG_DIR

    print_success "项目环境设置完成"
}

# 下载项目代码
download_project() {
    print_info "从 Git 仓库下载项目代码..."

    # 如果项目目录已存在，先备份
    if [ -d "$PROJECT_DIR" ]; then
        backup_dir="/tmp/${PROJECT_NAME}_backup_$(date +%Y%m%d_%H%M%S)"
        print_info "备份现有项目到: $backup_dir"
        mv $PROJECT_DIR $backup_dir
    fi

    # 克隆项目
    print_info "克隆项目仓库: $GIT_REPO"
    git clone -b $GIT_BRANCH $GIT_REPO $PROJECT_DIR

    if [ $? -ne 0 ]; then
        print_error "Git 克隆失败"
        exit 1
    fi

    print_success "项目代码下载完成"
}

# 部署项目
deploy_project() {
    print_info "部署项目到 $PROJECT_DIR..."

    # 下载项目代码
    download_project

    # 设置权限
    chown -R $USER:$USER $PROJECT_DIR

    # 进入项目目录
    cd $PROJECT_DIR

    # 安装依赖
    print_info "安装项目依赖..."
    sudo -u $USER npm install

    # 初始化数据库
    print_info "初始化数据库..."
    sudo -u $USER npm run init-db

    print_success "项目部署完成"
}

# 创建 PM2 配置文件
create_pm2_config() {
    print_info "创建 PM2 配置文件..."
    
    cat > $PROJECT_DIR/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: '$SERVICE_NAME',
    script: 'src/server.js',
    cwd: '$PROJECT_DIR',
    user: '$USER',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '$LOG_DIR/combined.log',
    out_file: '$LOG_DIR/out.log',
    error_file: '$LOG_DIR/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true
  }]
};
EOF

    chown $USER:$USER $PROJECT_DIR/ecosystem.config.js
    print_success "PM2 配置文件创建完成"
}

# 启动服务
start_service() {
    print_info "启动服务..."
    cd $PROJECT_DIR
    sudo -u $USER pm2 start ecosystem.config.js
    sudo -u $USER pm2 save
    
    # 设置开机自启
    pm2 startup systemd -u $USER --hp /home/$USER
    
    print_success "服务启动完成"
    print_info "服务地址: http://localhost:3000"
}

# 停止服务
stop_service() {
    print_info "停止服务..."
    sudo -u $USER pm2 stop $SERVICE_NAME
    print_success "服务已停止"
}

# 重启服务
restart_service() {
    print_info "重启服务..."
    sudo -u $USER pm2 restart $SERVICE_NAME
    print_success "服务已重启"
}

# 查看服务状态
status_service() {
    print_info "服务状态:"
    sudo -u $USER pm2 status
    echo ""
    print_info "服务详情:"
    sudo -u $USER pm2 show $SERVICE_NAME
}

# 查看日志
view_logs() {
    echo "选择要查看的日志类型:"
    echo "1) 实时日志 (所有)"
    echo "2) 实时日志 (仅输出)"
    echo "3) 实时日志 (仅错误)"
    echo "4) 历史日志 (最近100行)"
    echo "5) 返回主菜单"
    
    read -p "请选择 [1-5]: " log_choice
    
    case $log_choice in
        1)
            print_info "显示实时日志 (按 Ctrl+C 退出)..."
            sudo -u $USER pm2 logs $SERVICE_NAME
            ;;
        2)
            print_info "显示实时输出日志 (按 Ctrl+C 退出)..."
            sudo -u $USER pm2 logs $SERVICE_NAME --out
            ;;
        3)
            print_info "显示实时错误日志 (按 Ctrl+C 退出)..."
            sudo -u $USER pm2 logs $SERVICE_NAME --err
            ;;
        4)
            print_info "显示历史日志 (最近100行)..."
            sudo -u $USER pm2 logs $SERVICE_NAME --lines 100
            ;;
        5)
            return
            ;;
        *)
            print_error "无效选择"
            ;;
    esac
}

# 更新项目
update_project() {
    print_info "更新项目..."

    # 停止服务
    sudo -u $USER pm2 stop $SERVICE_NAME

    # 备份当前版本
    backup_dir="/tmp/${PROJECT_NAME}_backup_$(date +%Y%m%d_%H%M%S)"
    cp -r $PROJECT_DIR $backup_dir
    print_info "当前版本已备份到: $backup_dir"

    # 更新代码
    cd $PROJECT_DIR

    # 如果是git仓库
    if [ -d ".git" ]; then
        print_info "从 Git 仓库拉取最新代码..."
        sudo -u $USER git fetch origin
        sudo -u $USER git reset --hard origin/$GIT_BRANCH
        print_success "代码更新完成"
    else
        print_warning "不是git仓库，重新下载项目..."
        cd /tmp
        download_project
    fi

    # 更新依赖
    print_info "更新项目依赖..."
    cd $PROJECT_DIR
    sudo -u $USER npm install

    # 重启服务
    sudo -u $USER pm2 restart $SERVICE_NAME

    print_success "项目更新完成"
}

# 卸载服务
uninstall_service() {
    print_warning "这将完全删除服务和所有数据!"
    read -p "确认卸载? (y/N): " confirm
    
    if [[ $confirm =~ ^[Yy]$ ]]; then
        print_info "卸载服务..."
        
        # 停止并删除PM2进程
        sudo -u $USER pm2 delete $SERVICE_NAME 2>/dev/null || true
        sudo -u $USER pm2 save
        
        # 删除项目目录
        rm -rf $PROJECT_DIR
        rm -rf $LOG_DIR
        
        print_success "服务卸载完成"
    else
        print_info "取消卸载"
    fi
}

# 显示系统信息
show_system_info() {
    echo ""
    print_info "=== 系统信息 ==="
    echo "操作系统: $(lsb_release -d | cut -f2)"
    echo "Node.js版本: $(node --version 2>/dev/null || echo '未安装')"
    echo "PM2版本: $(pm2 --version 2>/dev/null || echo '未安装')"
    echo "Git版本: $(git --version 2>/dev/null || echo '未安装')"
    echo ""
    print_info "=== 项目配置 ==="
    echo "项目名称: $PROJECT_NAME"
    echo "项目目录: $PROJECT_DIR"
    echo "日志目录: $LOG_DIR"
    echo "服务用户: $USER"
    echo "Git仓库: $GIT_REPO"
    echo "Git分支: $GIT_BRANCH"
    echo ""
}

# 主菜单
show_menu() {
    clear
    echo "=================================================="
    echo "    淘宝订单管理系统 - 部署管理脚本"
    echo "=================================================="
    echo ""

    # 检查服务状态
    if sudo -u $USER pm2 describe $SERVICE_NAME &>/dev/null; then
        status=$(sudo -u $USER pm2 jlist | jq -r ".[] | select(.name==\"$SERVICE_NAME\") | .pm2_env.status" 2>/dev/null || echo "unknown")
        if [ "$status" = "online" ]; then
            echo -e "服务状态: ${GREEN}运行中${NC}"
        else
            echo -e "服务状态: ${RED}已停止${NC}"
        fi
    else
        echo -e "服务状态: ${YELLOW}未部署${NC}"
    fi

    echo ""
    echo "请选择操作:"
    echo ""
    echo "=== 部署管理 ==="
    echo "1) 全新部署 (首次安装)"
    echo "2) 更新项目"
    echo "3) 卸载服务"
    echo ""
    echo "=== 服务管理 ==="
    echo "4) 启动服务"
    echo "5) 停止服务"
    echo "6) 重启服务"
    echo "7) 查看状态"
    echo ""
    echo "=== 日志管理 ==="
    echo "8) 查看日志"
    echo "9) 清理日志"
    echo ""
    echo "=== 系统信息 ==="
    echo "10) 显示系统信息"
    echo "11) 测试服务连接"
    echo "12) 配置 Git 仓库"
    echo ""
    echo "0) 退出"
    echo ""
}

# 清理日志
clean_logs() {
    print_info "清理日志文件..."

    # 清理PM2日志
    sudo -u $USER pm2 flush

    # 清理日志目录
    if [ -d "$LOG_DIR" ]; then
        find $LOG_DIR -name "*.log" -type f -delete
        print_success "日志清理完成"
    else
        print_warning "日志目录不存在"
    fi
}

# 测试服务连接
test_connection() {
    print_info "测试服务连接..."

    # 检查端口是否监听
    if netstat -tlnp | grep :3000 &>/dev/null; then
        print_success "端口3000正在监听"

        # 测试HTTP连接
        if curl -s http://localhost:3000/health &>/dev/null; then
            print_success "HTTP服务响应正常"
            echo "访问地址: http://$(hostname -I | awk '{print $1}'):3000"
        else
            print_warning "HTTP服务无响应"
        fi
    else
        print_error "端口3000未监听"
    fi
}

# 配置 Git 仓库
configure_git_repo() {
    print_info "当前 Git 配置:"
    echo "仓库地址: $GIT_REPO"
    echo "分支: $GIT_BRANCH"
    echo ""

    read -p "是否要修改 Git 仓库地址? (y/N): " change_repo
    if [[ $change_repo =~ ^[Yy]$ ]]; then
        read -p "请输入新的 Git 仓库地址: " new_repo
        if [ ! -z "$new_repo" ]; then
            GIT_REPO="$new_repo"
            print_success "Git 仓库地址已更新为: $GIT_REPO"
        fi
    fi

    read -p "是否要修改分支? (y/N): " change_branch
    if [[ $change_branch =~ ^[Yy]$ ]]; then
        read -p "请输入分支名称 (默认: main): " new_branch
        if [ ! -z "$new_branch" ]; then
            GIT_BRANCH="$new_branch"
        else
            GIT_BRANCH="main"
        fi
        print_success "Git 分支已更新为: $GIT_BRANCH"
    fi

    print_info "Git 配置完成"
}

# 全新部署
full_deploy() {
    print_info "开始全新部署..."

    install_dependencies
    setup_project
    deploy_project
    create_pm2_config
    start_service

    echo ""
    print_success "=== 部署完成 ==="
    print_info "服务地址: http://$(hostname -I | awk '{print $1}'):3000"
    print_info "管理界面: http://$(hostname -I | awk '{print $1}'):3000/anchors"
    print_info "默认密码: 123456"
    echo ""
}

# 主程序
main() {
    check_root

    while true; do
        show_menu
        read -p "请选择操作 [0-12]: " choice

        case $choice in
            1)
                full_deploy
                read -p "按回车键继续..."
                ;;
            2)
                update_project
                read -p "按回车键继续..."
                ;;
            3)
                uninstall_service
                read -p "按回车键继续..."
                ;;
            4)
                start_service
                read -p "按回车键继续..."
                ;;
            5)
                stop_service
                read -p "按回车键继续..."
                ;;
            6)
                restart_service
                read -p "按回车键继续..."
                ;;
            7)
                status_service
                read -p "按回车键继续..."
                ;;
            8)
                view_logs
                ;;
            9)
                clean_logs
                read -p "按回车键继续..."
                ;;
            10)
                show_system_info
                read -p "按回车键继续..."
                ;;
            11)
                test_connection
                read -p "按回车键继续..."
                ;;
            12)
                configure_git_repo
                read -p "按回车键继续..."
                ;;
            0)
                print_info "退出脚本"
                exit 0
                ;;
            *)
                print_error "无效选择，请重新输入"
                sleep 2
                ;;
        esac
    done
}

# 运行主程序
main
