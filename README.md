# My Agent

基于 DeepSeek Harness 的本地个人 Agent，通过 `stdio` MCP 接入博查搜索、
Flyworks 数字人口型视频和飞常准出行查询。

## 技术组成

- DeepSeek Harness `0.2.1-rc.2`
- Bocha Search MCP commit `285bf4064a3317ad0f29966da8af5e1fdace14f1`
- Flyworks MCP commit `3561ded8ac0473eef21451caf7166dabeae47e3e`
- Variflight Tripmatch MCP `1.1.0`
- Node.js 22.19+
- Python 3.12，由 `uv` 隔离管理

Harness 和 MCP 不做源码耦合。两个 MCP 通过独立 Cordis 配置挂载。

博查 namespace 为 `bocha`，工具名为：

- `mcp__bocha__bocha_web_search`
- `mcp__bocha__bocha_ai_search`

Flyworks namespace 为 `flyworks`，提供以下工具：

- `mcp__flyworks__create_avatar`
- `mcp__flyworks__create_lipsync_video_by_audio`
- `mcp__flyworks__create_lipsync_video_by_text`
- `mcp__flyworks__get_task_status`
- `mcp__flyworks__download_completed_video`

Flyworks 包装层强制使用异步任务，避免一次工具调用持续轮询数分钟。

飞常准 namespace 为 `variflight`，提供 12 个航班、机票、机场天气、火车票及
车站查询工具。项目固定使用 npm `1.1.0`，并通过本地代理隐藏上游已废弃的
`searchTrainTickets`，分别使用 `searchTrainTicketsByCity` 和
`searchTrainTicketsByStation`。

## 初始化

```bash
pnpm install
pnpm run setup
cp .env.example .env
```

`pnpm run setup` 会在 `.runtime/bin` 下载固定版本的 `uv`，不依赖全局 Python
或 Homebrew。

编辑 `.env`，填入**轮换后的**博查 Key。Flyworks 和飞常准凭证按需配置：

```dotenv
BOCHA_API_KEY=your-rotated-key
FLYWORKS_API_TOKEN=your-private-token
VARIFLIGHT_API_KEY=your-variflight-key
```

任何已经出现在聊天、日志或截图中的 Key 都不应继续使用。
`FLYWORKS_API_TOKEN` 未配置时，Flyworks MCP 仍可被发现，但调用工具会返回明确错误，
不会影响博查和 Harness 启动。
`VARIFLIGHT_API_KEY` 未配置时同样不影响启动，也不会向飞常准发出查询请求。

## 启动

```bash
pnpm check
pnpm start
```

浏览器打开 <http://127.0.0.1:3080>。首次进入后，在
**设置 → 模型** 中配置模型 Provider 和凭证，再创建会话。

需要自动打开浏览器时运行：

```bash
pnpm start:open
```

端口冲突时可以把 Web 参数继续传给 Harness：

```bash
pnpm start -- --port 3081
```

## 验证

建议依次验证：

1. 工具列表中存在两个 `mcp__bocha__*`、五个 `mcp__flyworks__*` 和
   十二个 `mcp__variflight__*` 工具。
2. 输入“搜索 DeepSeek Harness 最新的官方文档，并给出来源”。
3. 输入“查询北京今天的天气”。
4. 输入“把这句话改得更简洁”，确认没有触发搜索。

`pnpm check` 只校验运行环境、依赖 pin、Python 导入和 Harness 配置，
并执行本地 MCP 工具发现；不会调用外部 API，也不会打印凭证。

## Flyworks 使用

本地图片、视频或音频先放入 `.runtime/media/flyworks/`，工具不能读取该目录之外的文件。
推荐流程：

1. 调用 `create_avatar`，获得头像任务 ID。
2. 调用 `get_task_status(task_type="avatar")`，完成后取得 avatar ID。
3. 调用文本或音频口型工具，获得视频任务 ID。
4. 调用 `get_task_status(task_type="video")` 查询结果。
5. 调用 `download_completed_video` 保存到 `.runtime/output/flyworks/`。

Flyworks 会把用于生成的媒体上传到其云服务。不要提交未获授权的敏感素材。

## 飞常准使用

先在 <https://ai.variflight.com> 获取 API Key 并配置
`VARIFLIGHT_API_KEY`。然后可直接在对话中输入：

- “查询明天北京到上海的航班，使用摘要模式，最多返回 10 条。”
- “查询今天 MU2157 的航班状态。”
- “查询后天苏州到上海所有车站的火车票。”
- “查询北京西站的车站信息。”

繁忙航线优先使用 `limit` 和 `detail="summary"` 控制返回长度。分页请求可能分别计费，
不要让 Agent 无限制翻页。

## 本地数据

- `.runtime/`：固定版本的 Python MCP 源码和虚拟环境
- `.runtime/media/flyworks/`：允许 Flyworks 读取的本地输入媒体
- `.runtime/output/flyworks/`：Flyworks 下载结果
- `.dsh/`：Harness profile、设置、会话和日志
- `.env`：本地凭证

以上路径都已加入 `.gitignore`。项目默认设置
`DSH_TELEMETRY_MODE=DISABLED`。

## 增加 MCP

为每个 MCP 新建独立的 `config/*.cordis.yml`，使用唯一 `id` 和
`serverName`，再在 `scripts/run.mjs` 中追加一个 `--patch` 参数。不要把
API Key 写进 Cordis 文件，应通过 `env` 显式映射所需环境变量。

产品范围和验收标准见 [`docs/PRD.md`](docs/PRD.md)。
