# Trae宝 · 移动端聊天助手

一个装在手机桌面上的「Trae宝」：立体主义拼贴风格的立绘角色 + 温柔治愈系对话 + 会自动记住你的事。

纯前端 PWA，无后端、无账号、无数据库，数据全部留在你自己的手机里。

---

## 功能

- **桌面图标启动**：Android Chrome「添加到主屏幕」后独立窗口运行，带图标和启动画面，脱离浏览器地址栏
- **角色立绘 + 8 种表情**：对话时角色会思考/打气，回复里带 `[[emo:标签]]` 时自动切换表情
- **逐字回显**：模型输出像打字一样逐字出现，角色同步做思考动作
- **长期记忆**：模型自动把值得记的事提炼成条目（如「用户最近常加班到很晚」），下次带上；可置顶、删除、一键清空
- **聊天记录本地留存**：刷新、关掉重开都在
- **危机兜底**：识别到自伤/极端情绪时，回复里带上心理援助热线
- **两种接入方式**：方舟直连（简单）或 Cloudflare Worker 代理（防跨域、藏 Key）

---

## 目录结构

```
traebao-pwa/
├── index.html              # 外壳：顶栏 / 舞台 / 消息区 / 输入框 / 设置面板
├── app.css                 # 米色纸底主题，100dvh 布局，适配刘海屏安全区
├── manifest.webmanifest    # PWA 清单：standalone / portrait / 192+512 图标
├── sw.js                   # Service Worker：预缓存应用外壳，静态资源 cache-first
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── src/
│   ├── main.js             # 应用装配：发送 → 组上下文 → 流式渲染 → 写回记忆
│   ├── mood.js             # 8 种情绪标签 → 表情图片映射
│   ├── ui/
│   │   ├── stage.js        # 立绘舞台：表情切换 / 流式思考动画
│   │   ├── timeline.js     # 消息气泡：追加 / 回放 / 滚动
│   │   ├── composer.js     # 输入框：自动增高、发送、禁用态
│   │   └── settings.js     # 设置面板：接入方式、Key、记忆管理
│   ├── memory/
│   │   ├── extractor.js    # 解析 [[emo:x]] / [[mem:x]] 标记块
│   │   ├── backends.js     # IndexedDB / localStorage 两种存储后端
│   │   ├── store.js        # 统一存储接口：会话、消息、记忆、KV
│   │   └── retriever.js    # 相似度召回 + 拼装上下文
│   └── llm/
│       ├── prompt.js       # 人格设定 + 标记协议 + 危机兜底规则
│       ├── sse.js          # SSE 解析器
│       ├── provider.js     # 流式请求与错误分类
│       ├── doubao.js       # 火山方舟 OpenAI 兼容端点
│       └── worker.js       # Worker 代理端点
├── worker/
│   └── worker.js           # Cloudflare Worker 源码（纯转发）
├── test/                   # Node 内置测试，零依赖
├── tools/                  # 辅助脚本（mock 服务器、图标生成、端到端验收）
│   ├── mock_server.py      # 本地假模型服务
│   ├── verify.js           # 标准端到端验收（7 项）
│   └── verify_xiaomi.js    # 小米浏览器场景验收（8 项）
└── docs/superpowers/       # 设计与实施计划文档
```

---

## 本地开发

```bash
cd traebao-pwa

# 跑测试（Node 18+，零依赖）
npm test

# 起本地静态服务（必须用 http，不要用 file:// 打开）
npm run dev   # → http://localhost:8080
```

没有真实 API Key 时，可以起一个本地 mock 模型服务来体验完整流程：

```bash
python3 tools/mock_server.py    # → http://127.0.0.1:8899/chat
```

然后在设置面板里：接入方式选「方舟直连」，接口地址填 `http://127.0.0.1:8899/chat`，API Key 随便填（比如 `test`），模型名随便填。

---

## 模型配置

### 方式一：方舟直连（默认）

在火山方舟控制台创建推理接入点，拿到 API Key 和模型 ID，然后填进设置面板：

| 字段 | 填什么 |
| --- | --- |
| 接口地址 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| API Key | 方舟控制台的 API Key |
| 模型名 | 你的接入点模型，如 `doubao-seed-1-6-250615` |

API Key 只存在你手机的 IndexedDB 里，请求由浏览器直接发给方舟，不经过任何第三方服务器。

**风险**：方舟接口是否允许浏览器跨域直连取决于其 CORS 策略。如果发消息时提示「连不上模型」，改用下面的 Worker 代理。

### 方式二：Worker 代理（兜底）

Worker 只做一件事：把请求原样转发给方舟，并在请求头里加上 `Authorization: Bearer <ARK_API_KEY>`。**记忆和聊天记录永远不会进入 Worker。**

部署步骤：

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler secret put ARK_API_KEY          # 方舟的 API Key
wrangler secret put TRAEBAO_ACCESS_TOKEN  # 你自己设一个随机长令牌
wrangler deploy
```

然后在设置面板里：接入方式选「Worker 代理」，Worker 地址填 `https://<你的worker>.workers.dev/v1/chat/completions`，访问令牌填上面那个随机长令牌。

> Worker 默认只校验 `X-Access-Token` 头。`worker/worker.js` 里的 `ARK_ENDPOINT` 可按需改成别的 OpenAI 兼容地址。

---

## 部署到线上

纯静态站点，任意静态托管都可以。**必须是 HTTPS 或 localhost**，否则 Service Worker 和「添加到主屏幕」不生效。

### GitHub Pages

```bash
git push origin main
# 仓库 Settings → Pages → Source 选 main 分支根目录
```

### Cloudflare Pages

```bash
npm install -g wrangler
wrangler pages deploy . --project-name traebao-pwa
```

部署后用手机 Chrome 打开站点地址 → 菜单「添加到主屏幕」即可。

---

## 表情与立绘

`src/assets/sprite/` 下 8 组 PNG + GIF，每组对应一种情绪：

| 情绪标签 | 图片 |
| --- | --- |
| `warm` | 08-定稿吧 |
| `care` | 05-这版够野 |
| `happy` | 07-甲方说好 |
| `excited` | 01-有灵感 |
| `curious` | 03-换个角度 |
| `playful` | 02-拆开看 |
| `think` | 06-对齐一下 |
| `cheer` | 04-再来一版 |

`src/mood.js` 里的 `EMO_SPRITE` 是唯一的映射表，改图片名只需要改这一处。

---

## 在小米浏览器上使用

小米浏览器（Mi Browser）是 Chromium 内核，可以正常使用。**但它不触发 `beforeinstallprompt`**，所以页面里的「添加到桌面」按钮不会出现 —— 需要手动从浏览器菜单添加。

### 添加到桌面步骤

1. 用小米浏览器打开站点地址
2. 点底部或顶部的 **≡ / ⋮ 菜单按钮**
3. 选 **「添加到桌面」**（部分版本叫「新建快捷方式」「添加书签到桌面」）
4. 名字改成「Trae宝」，确认

桌面会出现图标，点开即用。

### 小米浏览器的两点差异

| | Chrome / Edge | 小米浏览器 |
| --- | --- | --- |
| 安装入口 | 页面内一键按钮 | 只能走浏览器菜单 |
| 独立窗口 | 完整 standalone | 多数版本带顶部地址栏（MIUI 13+ 更接近独立窗口） |
| 触发 `beforeinstallprompt` | 是 | 否 |

因为不支持 `beforeinstallprompt`，页面底部会显示一行文字提示「用浏览器菜单里的『添加到桌面 / 新建快捷方式』」，就是引导你走上面这四步。

### 兼容性

针对小米浏览器的存量设备（MIUI 12 时代，Chromium 71~87）做了降级：

- 不用顶层 `await`（Chrome 89+）—— 改成 `boot()` 引导函数，否则整个模块解析失败、页面白屏
- `structuredClone`（Chrome 98+）—— 降级为 JSON 深拷贝
- 可选链 `?.` / 空值合并 `??`（Chrome 80+）—— 全部改写成普通条件判断
- `String.matchAll`（Chrome 73+）—— 改用 `exec` 循环
- `100dvh`（Chrome 108+）—— 加 `100vh` 兜底
- flex `gap`（Chrome 84+）—— 改用 `margin`

这些约束由 `test/compat.test.js` 自动守卫，以后引入新语法会被测试挡下。

### 如果发不出消息

小米浏览器的跨域策略和 Chrome 一致，方舟接口如果不允许浏览器直连，会提示「连不上模型」。**换 Worker 代理**即可，具体见上面的部署步骤。

---

## 已知限制

- **Android 优先**：iOS Safari 的「添加到主屏幕」体验弱一些（无安装引导按钮，需手动分享菜单添加）
- **小米浏览器无一键安装**：不触发 `beforeinstallprompt`，需从浏览器菜单手动添加，详见上面的专章
- **微信内置浏览器装不了**：微信里打开的页面是 WebView，不能安装 PWA。请用系统浏览器打开后再添加到桌面
- **方舟直连可能受 CORS 限制**：被跨域拦截时换 Worker 代理
- **没有多设备同步**：数据在本地，换手机不会跟着走
- **记忆靠模型自己提炼**：模型不输出 `[[mem:...]]` 就不会有新记忆；可在设置面板手动删除误记的内容
- **单会话**：v1 只维护一个会话，刷新后继续上次对话

---

## 安全提示

- API Key 只存在本机 IndexedDB，请求不经过我们的服务器
- 但 **浏览器直连意味着 Key 会出现在请求头里**，共用设备建议用 Worker 代理，把 Key 留在 Worker 侧
- 设置面板里的「清除所有数据」会清空聊天记录、记忆和 Key
