#!/bin/bash
# 食堂用餐服务管理系统 - 单机离线部署启动脚本（macOS / Linux）
# 使用方法：双击运行，或在终端内执行 ./start-mac-linux.sh

cd "$(dirname "$0")" || exit 1

echo "========================================"
echo "  食堂用餐服务管理系统 - 单机启动脚本"
echo "========================================"

if ! command -v node &> /dev/null; then
  echo "[错误] 未检测到 Node.js 运行环境。"
  echo "请先安装 Node.js（建议 18 或更高版本），可从 https://nodejs.org 下载离线安装包。"
  read -r -p "按回车键退出..."
  exit 1
fi

if [ ! -f "dist/server.cjs" ]; then
  echo "[错误] 未找到 dist/server.cjs 构建产物。"
  echo "请先在有网络的机器上执行 npm install 与 npm run build，"
  echo "然后把包含 dist/、node_modules/、package.json、.env 等文件的完整项目文件夹拷贝到本机后再运行本脚本。"
  read -r -p "按回车键退出..."
  exit 1
fi

echo "正在启动服务，请稍候..."
echo "启动后请用浏览器打开 http://localhost:端口号 （端口号见 .env 中的 PORT 配置，默认为 3000）"
echo "关闭本窗口即可停止服务。"
echo "----------------------------------------"

node dist/server.cjs
