# GourdSprite · AI Builder 多工具工作流平台

> 面向 AI Builder / Prompt Engineer / AX Designer 的本地化多工具工作台与工作流编排系统。
> 解决「AI时代，开发者/设计师同时使用 Trae、Cursor、VSCode、Dify、Coze 等多个工具，项目分散、流程断裂、Skills资产混乱」的真实痛点。
>
> 独立设计开发：从需求分析、产品架构、交互设计、4种工具Tab看板、GitHub Skills同步、后台管理系统到权限体系全链路实现。

**关键词**：`ai-builder-workflow` `skills-management` `prompt-engineering` `product-design` `workflow-orchestration` `news-aggregation`

## ✨ 核心特性

- **📋 Skills 管理** —— GitHub 技能资源抓取、中文翻译、分类筛选、下载跳转
- **📰 资讯日报** —— 7 源聚合:GitHub 涨星 / YouTube / B站 AI 视频 / IT之家 / 虎嗅 / TechCrunch / Ars Technica,每日 08:00 定时抓取、按日期归档沉淀
- **🔖 书签同步** —— Chrome 书签双向同步,三级 favicon 降级代理
- **🛠️ 工作台** —— 时钟 / 日历 / 任务管理 / 提醒 / 日记 / 项目扫描
- **📊 多工具项目看板** —— 四列看板(构想 → 待办 → 执行中 → 已完成),支持 Trae / DeepSeek / Antigravity / VSCode / 豆包 五个工具 Tab,拖拽流转与本地目录同步
- **📒 知识库** —— Obsidian 一键启动器
- **🔐 手机验证码登录** —— 登录保护 + 平台管理后台

## 📄 页面架构

| 页面     | URL                 | 功能                                                                             |
| -------- | ------------------- | -------------------------------------------------------------------------------- |
| 项目     | `/` (默认首页)    | 多工具项目看板(Trae / DeepSeek / Antigravity / VSCode / 豆包)                    |
| 资讯     | `/github.html`    | 7 源资讯日报(GitHub / YouTube / B站 / AI资讯 / 虎嗅 / TechCrunch / Ars Technica) |
| Skills   | `/discover`       | Skills 展示与分类筛选                                                            |
| 书签     | `/bookmarks.html` | Chrome 书签双向同步                                                              |
| 工作台   | `/workbench.html` | 时钟/日历/任务/扫描/日记/提醒                                                    |
| 知识     | `/knowledge.html` | Obsidian 启动器                                                                  |
| 管理后台 | `/admin.html`     | Skills 增删改查与分类配置                                                        |

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
├── server.js              # 后端服务(Express + 全部 API)
├── public/
│   ├── index.html         # Skills 页
│   ├── project.html       # 项目看板页(默认首页)
│   ├── github.html        # 资讯日报页(7 个 Tab)
│   ├── workbench.html     # 工作台
│   ├── bookmarks.html     # 书签页
│   ├── knowledge.html     # 知识页
│   ├── admin.html         # 管理后台
│   ├── css/               # 样式文件
│   └── js/                # 脚本(独立模块化)
├── data/                  # 运行时数据(任务/日记/书签/缓存/资讯归档, gitignore)
├── start.command          # 启动脚本(含 caffeinate)
├── setup-wake.command     # 定时唤醒脚本(pmset)
└── package.json
```

## 🔧 特色功能详解

### 资讯日报系统(v3.2 / v3.3)

- **7 源聚合**:🐙 GitHub 涨星日报 / ▶ YouTube 前沿科技视频 / 📺 B站 AI 科技视频 / 🇨🇳 IT之家 AI 资讯 / 🐯 虎嗅前沿科技 / 🌍 TechCrunch AI / 📡 Ars Technica
- **每日 08:00 定时抓取**:全部源自动沉淀至 `data/<模块>/YYYY-MM-DD.json`,左侧日期归档可回看历史
- **GitHub 抓取容错(v3.3)**:定时抓取失败自动每 30 分钟重试(匿名配额每小时重置),服务重启自动补抓今日,杜绝整天缺失
- **GitHub 日榜视频(v3.3)**:🎬 一键调用 data-video-template 管线把日榜渲染成短视频,每日抓取完成自动出片,前端实时轮询渲染状态
- **YouTube 抓取规则(v3.3)**:22 个前沿科技频道池(AI / 生命·脑科学 / 空间物理 / 前沿综合) + 每日 views 快照算**播放量增速**排序 + 近 7 天窗口 + 7 天严格去重 + Shorts 过滤 + RSS 失败重试,卡片显示 🚀 增速徽章
- **B站抓取规则**:近 7 天 + 10 个 AI 关键词配额制 + 科技分区白名单 + 播放量排序,避免消费电子霸榜
- **虎嗅抓取规则**:官方「前沿科技」频道 API(channel_id=105) + RSS 正文摘要补齐
- **海外源**:TechCrunch / Ars Technica 官方 RSS,无需认证;缩略图经同源代理规避 ORB 拦截

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
- **五工具 Tab**:
  - 🛠️ **Trae** —— 项目目录 `~/Trae/`,一键打开 Trae CN 并粘贴提示词
  - 🔍 **DeepSeek** —— DeepSeek 对话管理看板(构想/待办/执行中/已完成)
  - ⚡ **Antigravity** —— 项目目录 `~/Antigravity/`,一键打开 Antigravity IDE
  - 🟢 **VSCode** —— 项目目录 `~/VS-Code/`,一键打开 Visual Studio Code
  - 🤖 **豆包** —— 豆包对话管理卡片,打开豆包 APP 并复制标题供搜索
- **创建即建目录**:弹窗创建项目时,自动在对应工具目录下生成同名文件夹
- **目录同步**:一键扫描本地目录,新项目自动加入看板已完成列
- **目录删除同步**:本地删除文件夹,看板自动移除对应卡片
- **自动执行**:待办列开关按钮,30 秒轮询自动启动有提示词的任务(执行中上限 5 个)
- **逆向移动**:已完成项目可移回待办/执行中,支持新一轮开发
- **GitHub 推送**:已完成列卡片支持一键 `git push`

## 🎯 为什么做这个平台？（产品设计思考）

### 真实痛点：AI Builder 的「多工具困境」

2026 年，每一个 AI Builder 同时使用 4-6 个不同的 AI 工具是常态：

- 用 **Trae / Cursor** 写代码和做Agent开发
- 用 **Dify / Coze / 扣子** 搭工作流
- 用 **VSCode** 做传统开发
- 用 **豆包 / 通义** 做素材和文案
- 用 **GitHub Skills** 下载和管理技能资产

结果是：项目分散在N个工具目录里，Skills散落在各处，工作流断裂，找不到上一个项目用了什么Prompt。

### 我的解法（PM级产品定义）

> **不是再造一个工具，是做「工具之上的工作台」——连接所有工具，提供统一的项目流转、技能管理、任务调度入口。**

产品设计三原则：

1. **不替代工具，只连接工具**：每个工具Tab只是「入口 + 资产同步」，实际编辑回到原生工具
2. **本地优先，隐私第一**：所有数据存在本地，不接入任何云服务，代码开源可审
3. **工作流闭环**：Skills发现 → 项目构想 → 看板流转 → 自动启动 → 知识沉淀

---

## 📌 版本里程碑

| 版本 | 日期       | 说明                                                                                                    |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-08-05 | 初始平台:6 页面 + GitHub 集成 + 工作台                                                                  |
| v2.0 | 2026-08-06 | 项目看板系统:四列看板 + Trae 同步 + 自动执行                                                            |
| v3.0 | 2026-08-06 | 多工具看板:Antigravity / VSCode / 豆包 Tab + 平台更名 GourdSprite                                       |
| v3.1 | 2026-08-06 | 手机验证码登录 + 平台管理后台 + Skills 管理迁移                                                         |
| v3.2 | 2026-09-23 | 资讯日报页:GitHub / YouTube / B站 / IT之家 / 虎嗅 / TechCrunch / Ars Technica 七源聚合,每日定时抓取归档 |
| v3.3 | 2026-10-06 | 抓取规则升级:YouTube 22 频道池 + 播放量增速排序 + 严格去重;GitHub 失败自动重试 + 日榜视频生成管线 |

## 📝 设计哲学

- **本地优先**:所有数据存本地,隐私可控
- **Apple 风格**:磨砂玻璃、圆角卡片、克制动效
- **无框架依赖**:原生 HTML/CSS/JS,易维护易迁移
- **工作流闭环**:从技能发现 → 项目规划 → 任务执行 → 知识沉淀

---

## 💼 这个项目体现的产品能力

作为 AX / AI PM 方向的项目，它展示了：

1. **需求挖掘能力**：发现「多工具困境」这个真实痛点（而非拍脑袋想需求）
2. **产品定义能力**：不替代工具，只做连接者——这种产品边界判断是PM的核心能力
3. **全栈交付能力**：Node.js后端 + 原生前端 + GitHub API集成 + JWT权限 + 管理后台
4. **版本规划能力**：清晰的v1/v2/v3迭代路径，每个版本解决一个核心问题

---

**项目起始**:2026 年 8 月 1 日
**仓库创建**:2026 年 8 月 5 日
