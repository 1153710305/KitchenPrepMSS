#!/bin/bash
# 食堂用餐服务管理系统 - 单机离线部署启动脚本（macOS / Linux）
# 使用方法：双击运行，或在终端内执行 ./start-mac-linux.sh

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-3000}"
if [ -f ".env" ]; then
  env_port=$(grep -E '^PORT=' ".env" | head -n 1 | cut -d= -f2- | tr -d '"\r')
  if [ -n "$env_port" ]; then
    PORT="$env_port"
  fi
fi
URL="http://localhost:${PORT}"

echo "========================================"
echo "  食堂用餐服务管理系统 - 单机启动脚本"
echo "========================================"

if ! command -v node &> /dev/null; then
  echo "[错误] 未检测到 Node.js 运行环境。"
  echo "请先安装 Node.js 22.x LTS 版本（必须与准备部署包时使用的大版本完全一致，见部署指南.md），可从 https://nodejs.org 下载离线安装包。"
  read -r -p "按回车键退出..."
  exit 1
fi

NODE_VER=$(node --version)
if [[ "$NODE_VER" != v22.* ]]; then
  echo "[警告] 检测到当前 Node.js 版本为 $NODE_VER，本系统要求 22.x LTS 版本。"
  echo "本地存储所用的 better-sqlite3 是原生二进制模块，版本不匹配会导致启动报错 ERR_DLOPEN_FAILED，详见部署指南.md。"
  read -r -p "按回车键继续（不建议）或 Ctrl+C 退出..."
fi

if [ ! -f "dist/server.cjs" ]; then
  echo "[错误] 未找到 dist/server.cjs 构建产物。"
  echo "请先在有网络的机器上执行 npm install 与 npm run build，"
  echo "然后把包含 dist/、node_modules/、package.json、.env 等文件的完整项目文件夹拷贝到本机后再运行本脚本。"
  read -r -p "按回车键退出..."
  exit 1
fi

echo "正在启动服务，请稍候..."
echo "启动后请用浏览器打开 ${URL}"
echo "关闭本窗口即可停止服务。"
echo "----------------------------------------"

if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "未检测到可用浏览器打开命令，请手动访问 ${URL}"
fi

node dist/server.cjs
