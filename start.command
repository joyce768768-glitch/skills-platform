#!/bin/bash
cd "$(dirname "$0")"
echo "启动 Skills Platform（防睡眠模式，锁屏也会响铃提醒）..."
echo "按 Ctrl+C 停止"
caffeinate -i node server.js
