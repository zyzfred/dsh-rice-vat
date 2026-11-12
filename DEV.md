# 本地开发与迭代

这份仓库在**本机 profile 里是 link 安装**：DSH 直接从本目录加载 Host 半（`index.js` / `platform-usage.js`）和面板（`client.js`）。改文件不需要重新安装、不需要发版。

```bash
readlink "$DSH_PROFILE_DIR/node_modules/dsh-rice-vat"   # 应指回本目录
grep dsh-rice-vat "$DSH_PROFILE_DIR/package.json"        # 应为 link:/…/dsh-rice-vat
```

> 换目录或换机器时：`install_bundle` 对已是依赖的包会返回 `already-installed`，必须先 `remove_bundle dsh-rice-vat` 再 `install_bundle <绝对目录>`。

## 三类改动，三种生效方式

| 改的是什么 | 怎么生效 | 页面要刷新吗 |
|---|---|---|
| `index.js` / `platform-usage.js`（Host：路由、账号用量、计价、账本、鉴权、命令） | 触发一次 profile 重组，约 1 秒 | 不用，面板会继续轮询到新数据 |
| `client.js`（面板 UI、动画、拖动/缩放、i18n） | 重组 + 刷新页面 | **要** |
| `package.json` / `cordis.patch.yml` / `locale/*.json` / 新增素材文件 | **完全退出 DSH 再打开** | 要（重开即是新页面） |

已实测（2026-11-12）：改 `index.js` 加一个 `/diag` 字段 → 触发重组 → 1 秒内 `/api/rice-bowl/diag` 出现该字段；改回后同样消失。重组是**真正的重新 import**，`/diag` 计数器会归零，账本在磁盘上不受影响（内存锚点与账号用量缓存会重新建立）。

## 触发重载

最快的方式是让当前会话的 agent 调一次：

```
plugin_manager  set_plugin  include:rice-vat  enabled:true
```

返回值是 `changed:false`，但它照样会重组 profile，并把磁盘上变过的 link 包重新 import。也可以到 **插件** 页把 `dsh-rice-vat` 关掉再打开——那是两次重载，面板会闪一下。

## 每次改完怎么验

```bash
node --test scripts/test-platform-usage.mjs   # 账号用量解析 / 逐日 / 7 日均 / 月回退
node --test scripts/test-host-command.mjs     # /rice-vat on|off 及 ui.json 持久化
node scripts/dev-check.mjs                   # diag + 11 张素材 + 账户状态
node scripts/dev-check.mjs --token <tok>      # 再验 /state 与 /pulse（余额、账号今日/总额/日均、ui 开关）
node scripts/dev-check.mjs --watch 1          # 盯着：计数归零 = 插件刚重载
```

`--token` 用的是页面里的 `window.__RICE_BOWL_TOKEN__`（DevTools console 一行就能取到）。它只存哈希在 Host 上，取不回来，所以不传就只验免鉴权的 `/diag` 和素材路由。

断言口径：

- `result OK` = diag 正常、11/11 素材可读、账户已登录。
- `/diag` 的 `usage`：`hasToday` / `hasTotal` / `hasAverage` 应为 true，`dailyCount` 约 30，`source: "platform"`。
- `/diag` 的 `commands.registered` 应为 true；否则 `/rice-vat` 没挂上。
- 余额/用量数值是否合理，还要肉眼看一眼面板；`/diag` 不含金额。

## 调试旋钮

| 开关 | 位置 | 用途 |
|---|---|---|
| `FORCE_EMPTY` | `index.js` 顶部 | 强制空缸，检查 `girl-sleep` 合成位置，`/diag` 会标 `preview: forced-empty` |
| `BALANCE_TTL_MS` | `index.js` | 余额缓存时长，轮询调试时调小 |
| `USAGE_TTL_MS` | `index.js` | 账号用量缓存时长（默认 60s）；调小可更快看到 Platform 变化 |
| `EAT_WINDOW_MS` | `index.js` | 吃米动画的「新鲜消耗」窗口 |

`/api/rice-bowl/diag` 免鉴权，只有计数、账号状态、用量是否有值/缓存年龄、UI 开关、命令注册状态，**没有金额**。`/state`、`/pulse` 要 owner 或页面令牌。别把 token 贴进 issue。

## 账号用量验证

账号级用量来自 Platform 控制台接口，Host 侧通过 `deepseekAccount.getPlatformSession()` 拿 grant，不经过 Client：

- `get_user_summary` → `total_costs`（累积炫米）
- `by_api_key/cost` → 今日/逐日，失败回退 `/usage/cost`
- 7 日日均在 Host 计算，Client 用余额算“还能吃几天”

如果重载后 `usage.lastError` 非空：

1. 确认 Platform 账号仍登录（`/diag.account.signedIn`）。
2. 确认 DSH 版本有 `getPlatformSession()`。
3. 看 `usage.lastError` 是 `platform/http-*`、`platform/code-*` 还是 `platform/network`；`/diag` 不会泄露 token。
4. Platform 控制台接口是私有接口，改版时会失败；余额仍可用，卡片会显示 `—` + “账号数据暂不可用”。

## 视觉开关验证

`/rice-vat off` 会写 `$DSH_HOME/rice-bowl/ui.json`，并让 `/pulse` 返回 `ui.visible: false`；Client 只是不渲染，轮询和账本继续。验证：

```bash
cat "$DSH_HOME/rice-bowl/ui.json"
curl -s http://127.0.0.1:64152/api/rice-bowl/diag | python3 -c 'import sys,json; print(json.load(sys.stdin)["ui"])'
```

命令本身由 `scripts/test-host-command.mjs` 覆盖；真实页面需要刷新到新 `client.js` 才会响应 `ui.visible`。

## 可选：保存即重载（未在本机验证）

默认 `hmr` 只监听 profile 配置（`root: []`），不监听源码，所以改完得手动触发上面那步。想省掉手动触发，可以在 **profile** 的 `cordis.patch.yml`（不是本仓库）加：

```yaml
- id: hmr
  config:
    root: ["/absolute/path/to/dsh-rice-vat"]
```

未验证：HMR 的模块根监听能否覆盖 link 到仓库外的包。无效就删掉这段——它只影响开发体验，不影响插件行为。`client.js` 无论如何都要刷新页面。

## 发布清单

- 版本号只改 `package.json`；Host 从 manifest 读版本并在 `/state` 回报，所以版本漂移会自己暴露。
- `package.json` 的 `files` 是发布白名单，必须包含 `platform-usage.js`；`scripts/`、`DEV.md`、`preview/` 不在里面，不会被发出去。
- 发版前跑一遍 `node --test scripts/` 和 `node scripts/dev-check.mjs`，再 `npm pack --dry-run` 看包内容。
- 素材文件/`locale`/`package.json` 改动后，真实页面要**完全退出 DSH 再打开**；只重载 Host 不会更新客户端。
