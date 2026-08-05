# Skills Hub - 项目时间线

## 项目概览

- **项目名称**：Skills Hub（个人技能管理与工作台平台）
- **项目起始**：2026 年 8 月 1 日
- **仓库创建**：2026 年 8 月 5 日
- **技术栈**：Node.js + Express + 原生 HTML/CSS/JavaScript
- **设计风格**：Apple 风格（磨砂玻璃导航、圆角卡片、优雅动画）

## 开发时间线

### 2026-08-01 · 项目启动
- 确定需求：构建管理 Skills 的网页，苹果风格设计
- 前端展示页面 + 后台管理页面架构
- GitHub 技能地址导入功能
- 技能类型筛选（设计类、视频剪辑类、PPT类等，可配置）
- 自动抓取 GitHub 技能名称和描述并翻译成中文
- 下载按钮和 GitHub 跳转功能

### 2026-08-02 · GitHub 安全集成
- 使用 Octokit 官方库替代原始抓取方式
- 配置 User-Agent 头为 SkillsPlatform/v1.0
- GitHub Personal Access Token 支持（5000次/小时 vs 60次/小时）
- 实现 1 小时本地缓存（data/cache/ 目录）
- 实时 API 速率限制监控（绿/橙/红视觉指示器）
- 错误处理：404 仓库不存在、401 Token无效、403 配额用完
- Chrome 书签双向同步功能
- 书签 logo 三级降级代理（Google favicon → icon.horse → favicon.ico → SVG占位）
- 书签滚动稳定性修复（移除 sticky、结构签名对比、恢复 scrollY）

### 2026-08-03 · 工作台建设
- 时钟 + 日历模块
- 每日计划任务管理（添加/完成/删除/优先级）
- 项目扫描（Trae 本地项目自动发现）
- 规则引擎生成工作建议
- 提醒功能（开始时间/截止时间、持续响铃、横幅交互）
- 每晚 21:00 写明日计划提醒
- caffeinate -i 防睡眠启动脚本
- 后端定时扫描器（5秒/次，系统铃声提醒）
- 自动打开 Trae 项目 + 粘贴提示词功能
- 工作台日记模块（按日期记录）
- 知识模块（Obsidian 集成，仅打开不读取）

### 2026-08-05 · 项目页面改造 + GitHub 部署
- 项目页面改造为网页入口集合（简历/作品集/实验项目）
- 分类筛选功能
- 网站 favicon 自动获取
- 编辑/删除功能
- 知识页面（Obsidian 启动器）
- 导航栏统一（发现/书签/工作台/项目/知识/管理后台）
- Git 初始化并推送到 GitHub 私人仓库

### 2026-08-06 · v2.0 项目看板系统
- **看板迁移**：项目看板从工作台迁移到项目页面，独立 kanban.js 模块
- **四列看板**：构想 → 待办 → 执行中 → 已完成，支持拖拽流转
- **创建项目**：弹窗创建（名称+描述+提示词+文档链接），自动在 ~/Trae/ 生成项目文件夹
- **Trae 同步**：一键扫描 ~/Trae/ 目录，新项目同步到已完成列
- **目录删除同步**：~/Trae/ 下删除项目文件夹，看板自动移除对应卡片
- **逆向移动**：已完成项目可移回待办/执行中，支持新一轮开发
- **自动执行**：待办列开关按钮，自动启动有提示词的待办项目（30秒轮询，执行中上限5个）
- **快捷操作**：在Trae打开 / push github / 编辑提示词
- **UI 统一**：卡片字段一致（名称+描述+按钮）、深色标题栏、创建按钮等高
- **导航调整**：项目菜单移到第一位，默认首页指向项目页面

## 页面架构

| 页面 | URL | 功能 |
|------|-----|------|
| 发现 | / | Skills 展示与分类筛选 |
| 书签 | /bookmarks.html | Chrome 书签双向同步与管理 |
| 工作台 | /workbench.html | 时钟/日历/任务/扫描/日记/提醒 |
| 项目 | /project.html | 网页项目入口管理与预览 |
| 知识 | /knowledge.html | Obsidian 启动器 |
| 管理后台 | /admin.html | Skills 增删改查与分类配置 |

## 后端 API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/workbench/projects | GET | 获取 Trae 项目列表 |
| /api/workbench/paths | GET/POST | 自定义路径管理 |
| /api/workbench/projects/:id/scan | GET | 扫描项目状态 |
| /api/workbench/plans/:date | GET/POST | 每日计划读写 |
| /api/workbench/diary/:date | GET/POST | 日记读写 |
| /api/workbench/reminders | GET/POST/DELETE | 提醒管理 |
| /api/workbench/open-project | POST | 打开项目（Trae/Finder） |
| /api/workbench/open-obsidian | POST | 打开 Obsidian |
| /api/web-projects | GET/POST | 网页项目 CRUD |
| /api/web-projects/:id | PUT/DELETE | 网页项目更新/删除 |
| /api/config/github-token | GET/POST/DELETE | GitHub Token 管理 |
| /api/github/repo | GET | GitHub 仓库信息抓取 |
