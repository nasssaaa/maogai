# 刷题宝 · 毛概题库练习（全栈版）

基于 508 题完整毛概题库（章节 1-8）的现代化刷题网站。

**架构**：服务端 + 客户端运行在同一个服务器上。数据（掌握、错题、收藏、答案补充、考试历史等）全部存储在服务器的 SQLite 数据库中，通过 `/api` 路由访问。支持多设备同步。

## 特性

- **练习模式** + **考试模式**（默认 30 单选 + 20 多选，30 分钟，倒计时 + 完整答题卡）
- **历史考试记录**：服务器持久化，可在不同设备查看/回放
- **真实登录系统**：用户名 + 密码（后端 bcrypt 哈希 + JWT）
- 数据永不丢失，支持跨终端同步
- 黑金主题、纯前端 + Express 后端

## 快速开始

```bash
npm install
npm run dev
```

- 前端开发服务器：http://localhost:5188（Vite，绑定 0.0.0.0）
- 后端通过 Vite 自动代理 `/api` 请求（默认后端端口 3888）

**修改后端端口（通过环境变量，无需改代码）**：

```bash
# macOS / Linux
PORT=4000 npm run dev

# Windows PowerShell / cmd（推荐）
cross-env PORT=4000 npm run dev
```

- 前端仍使用 `/api` 路径，Vite 会自动把请求代理到你指定的 `PORT`
- 后端会在对应端口启动，并打印实际监听地址
- 生产环境同样生效：`cross-env PORT=4000 npm start`

生产环境单进程运行：

```bash
npm run build
npm start
```

访问 http://localhost:3888（或你设置的 PORT）即可同时使用前端和所有 API。

**注意**：Vite 已配置 `host: '0.0.0.0'` 和 `allowedHosts: ['wwhnb.wh1234567.com']`，可通过域名访问开发服务器。

## 开发说明

- `npm run dev` 使用 concurrently 同时启动后端（nodemon）和前端（vite）
- Vite 在 `vite.config.js` 中配置了端口 5188、host 0.0.0.0、allowedHosts，以及 `/api` 代理（读取 `process.env.PORT`）
- 后端（`server/index.js`）默认监听 3888（`process.env.PORT || 3888`），绑定 0.0.0.0
- 数据持久化在 `server/data/tiku-brush.db`（SQLite，better-sqlite3）
- 所有用户数据（掌握、错题、收藏、答案补充、考试历史等）都存在服务端

不同设备用相同用户名 + 密码登录即可看到完全一致的服务器端数据。

## 数据说明

- 原始题目来自桌面 `final_mao_gai_questions.json`（已复制到 `src/data/questions.json`）
- 本题库 **所有 508 题均已包含完整选项和答案**，可直接练习并自动批改。
- “答案补充/覆盖”功能仍然可用，用于用户自定义修正、添加解释，或个人笔记。用户补充的答案优先级高于题库原答案。
- **所有进度数据（掌握、错题、收藏、历史考试、最后位置）都保存在服务器 SQLite**，跨设备自动同步。

## 键盘快捷键（练习中）

- `1` `2` `3` `4` ... 选择对应选项
- `A` `B` `C` `D` 同上
- `←` `→` 上一题 / 下一题
- `空格` 或 `Enter` 下一题
- `R` 随机跳到本会话内另一题
- `S` 提交答案（有标准答案时）

## 构建生产版本

```bash
npm run build
```

`dist/` 目录可部署到 Vercel、Netlify、GitHub Pages 等任意静态托管平台（前端）。

后端数据由 Supabase 提供，无需自己部署服务器。

---

**跨设备同步说明**：只要在不同终端使用相同的用户名 + 密码登录，即可看到完全一致的掌握进度、错题本和历史考试记录。

Enjoy 高效刷题！如需扩展更多章节或字段，只需替换/更新 src/data/questions.json 即可。