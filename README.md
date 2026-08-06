# GourdSprite

> 个人技能管理与多工具项目工作台 · Apple 风格设计

一个集 Skills 资源管理、书签同步、工作台、多工具项目看板于一体的本地化 Web 应用,帮助管理日常开发工作流与知识资产。

## ✨ 核心特性

- **📋 Skills 管理** —— GitHub 技能资源抓取、中文翻译、分类筛选、下载跳转
- **🔖 书签同步** —— Chrome 书签双向同步,三级 favicon 降级代理
- **🛠️ 工作台** —— 时钟 / 日历 / 任务管理 / 提醒 / 日记 / 项目扫描
- **📊 多工具项目看板** —— 四列看板(构想 → 待办 → 执行中 → 已完成),支持 Trae / Antigravity / VSCode / 豆包 四个工具 Tab,拖拽流转与本地目录同步
- **📒 知识库** —— Obsidian 一键启动器
- **⚙️ 管理后台** —— Skills 增删改查与分类配置

## 📄 页面架构

| 页面 | URL | 功能 |
|------|-----|------|
| 项目 | `/` (默认首页) | 多工具项目看板(Trae / Antigravity / VSCode / 豆包) |
| Skills | `/discover` | Skills 展示与分类筛选 |
| 书签 | `/bookmarks.html` | Chrome 书签双向同步 |
| 工作台 | `/workbench.html` | 时钟/日历/任务/扫描/日记/提醒 |
| 知识 | `/knowledge.html` | Obsidian 启动器 |
| 管理后台 | `/admin.html` | Skills 增删改查与分类配置 |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 16
- macOS(部分功能依赖:系统铃声、caffeinate、pmset、Obsidian)

### 安装与启动

```bash
# 安装依赖
npm install

# 启动服务
npm start
# 或双击 start.command(自动 caffeinate 防睡眠)

# 访问应用
open http://localhost:3000/
```

### GitHub Token 配置(可选但推荐)

为避免触发 GitHub API 速率限制(60 次/小时),建议配置 Personal Access Token:

1. 访问 https://github.com/settings/tokens/new
2. 勾选 `public_repo` 权限,生成 Token
3. 在管理后台页面 → 「GitHub API 配置」粘贴并保存

配置后速率限制提升至 **5000 次/小时**,并启用 1 小时本地缓存。

## 🛠️ 技术栈

- **后端**:Node.js + Express
- **前端**:原生 HTML / CSS / JavaScript(无框架)
- **GitHub 集成**:Octokit 官方库(@octokit/rest)
- **设计风格**:Apple 风格(磨砂玻璃导航、圆角卡片、优雅动画)

## 📦 项目结构

```
skills_platform/
├── server.js              # 后端服务(Express)
├── public/
│   ├── index.html         # Skills 页
│   ├── project.html       # 项目看板页(默认首页)
│   ├── workbench.html     # 工作台
│   ├── bookmarks.html     # 书签页
│   ├── knowledge.html     # 知识页
│   ├── admin.html         # 管理后台
│   ├── css/               # 样式文件
│   └── js/                # 脚本(独立模块化)
├── data/                  # 运行时数据(任务/日记/书签/缓存)
├── start.command          # 启动脚本(含 caffeinate)
├── setup-wake.command     # 定时唤醒脚本(pmset)
└── package.json
```

## 🔧 特色功能详解

### GitHub 安全集成
- 使用 Octokit 官方库替代原始抓取,防止账号封禁
- User-Agent 头配置(GitHub 强制要求)
- 实时 API 速率限制监控(绿/橙/红视觉指示器)
- 错误处理:404 仓库不存在 / 401 Token 无效 / 403 配额用完

### 工作台
- **任务管理**:支持优先级、起止时间、关联项目、工作提示词
- **提醒系统**:5 秒轮询、持续响铃、横幅交互、macOS Glass 系统铃声
- **自动唤醒**:`pmset` 每日 8:30 自动唤醒开始扫描
- **防睡眠**:`caffeinate -i` 保持白天运行不睡眠
- **一键启动**:自动打开 Trae 项目并粘贴工作提示词

### 多工具项目看板系统(v3.0)
- **四列流转**:构想 → 待办 → 执行中 → 已完成,支持拖拽
- **四工具 Tab**:
  - 🛠️ **Trae** —— 项目目录 `~/Trae/`,一键打开 Trae CN 并粘贴提示词
  - ⚡ **Antigravity** —— 项目目录 `~/Antigravity/`,一键打开 Antigravity IDE
  - 🟢 **VSCode** —— 项目目录 `~/VS-Code/`,一键打开 Visual Studio Code
  - 🤖 **豆包** —— 豆包对话管理卡片,打开豆包 APP 并复制标题供搜索
- **创建即建目录**:弹窗创建项目时,自动在对应工具目录下生成同名文件夹
- **目录同步**:一键扫描本地目录,新项目自动加入看板已完成列
- **目录删除同步**:本地删除文件夹,看板自动移除对应卡片
- **自动执行**:待办列开关按钮,30 秒轮询自动启动有提示词的任务(执行中上限 5 个)
- **逆向移动**:已完成项目可移回待办/执行中,支持新一轮开发
- **GitHub 推送**:已完成列卡片支持一键 `git push`

## 📌 版本里程碑

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-08-05 | 初始平台:6 页面 + GitHub 集成 + 工作台 |
| v2.0 | 2026-08-06 | 项目看板系统:四列看板 + Trae 同步 + 自动执行 |
| v3.0 | 2026-08-06 | 多工具看板:Antigravity / VSCode / 豆包 Tab + 平台更名 GourdSprite |

## 📝 设计哲学

- **本地优先**:所有数据存本地,隐私可控
- **Apple 风格**:磨砂玻璃、圆角卡片、克制动效
- **无框架依赖**:原生 HTML/CSS/JS,易维护易迁移
- **工作流闭环**:从技能发现 → 项目规划 → 任务执行 → 知识沉淀

---

**项目起始**:2026 年 8 月 1 日
**仓库创建**:2026 年 8 月 5 日
