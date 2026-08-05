#!/bin/bash
# 设置每天 8:30 自动唤醒电脑（需 sudo）
echo "===== 设置每天 8:30 自动唤醒电脑 ====="
echo "需要输入电脑密码（sudo 权限）..."
sudo pmset repeat wake MTWTFSS 08:30:00
echo ""
echo "✓ 已设置：每天 8:30 自动唤醒"
echo "说明：电脑唤醒后，Node 服务器进程会恢复运行，扫描器继续工作。"
echo ""
echo "查看当前唤醒计划："
pmset -g sched
echo ""
echo "取消唤醒计划：sudo pmset repeat cancel"
