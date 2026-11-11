# 米缸 · Rice vat

A DeepSeek Harness UI plugin that shows the account balance as a **rice vat**,
with a Q-version whale-girl (鲸鱼娘) companion who eats the rice while you spend
and falls asleep on the empty vat when it runs out.

## 四档米位

The artwork is four discrete states, selected by balance:

| 余额 | 米位 | 实现 |
|---|---|---|
| **> ¥100** | 米堆成小山，溢出缸口 | `vat-overflow` 原画 |
| **¥6 – ¥100** | 米面**连续下降** | `vat-empty` + 米面叠加层，按余额在缸口内下移 |
| **¥0 – ¥6** | 缸底只剩几粒米 | `vat-low` 原画 |
| **¥0** | 空缸，她趴在上面睡 | `vat-empty` + `girl-sleep` |

中间段没有原画，用素材包自带的 `vat-rice-mask` / `vat-rice-overlay` 合成：
空缸为底，米面层按「(余额−6)/94」在缸口内下移，最大位移 19.05%（= 缸口可见高度）。
`vat-full` 原画保留为合成不可用时的兜底。

Thresholds are fixed by design and **not** configurable.

## 状态

| 状态 | 触发 | 素材 |
|---|---|---|
| 待机 | 默认 | `girl-idle` |
| 吃米 | 每次模型调用产生消耗 | `girl-eat`：**16 帧动画**（4.6s，碗里的米吃到见底）+ 米粒飞溅 |
| 告急 | 0 < 余额 ≤ ¥6 | `girl-low` |
| 空缸 | 余额 = 0 | `girl-sleep` **叠在** `vat-empty` 上 |

吃米时的演出：米粒从**她怀里的碗**中溅出，鲸鱼娘切到埋头吃的姿态。
米缸**始终显示真实余额档位**，不参与吃米演出。

> 碗里的米「越吃越少直到见底」需要额外帧素材（原画里碗内壁被米挡住，无法合成），
> 规格见 `ASSETS-SPEC.md` §5.5。

## 渲染位置

挂在 `shell.overlay`（全框浮层），以 CSS 定位停在侧边栏底部。
侧边栏本身是 `single` 槽位，替换它等于重写整列，所以本插件只做视觉锚定，不占布局位。

## 数据

| 字段 | 来源 |
|---|---|
| 余额、充值、赠金 | `ctx.deepseekAccount.getBalance()`（Host） |
| 今日 / 累计消耗 | `session/event` → `assistant/message.usage`，在 Host 折叠 |
| 实时余额 | 锚点余额 − 锚点之后累计消耗（pulse 每 1.5s 下发） |
| 计价 | 内置 DeepSeek CNY 价目表 |
| 多 key 余额 | 未实现 |

累计统计**从插件首次加载开始**，不回放历史会话。DSH 之外的消耗会降低余额但不会被归因。

### 计价

| 模型 | 输入（缓存命中） | 输入（未命中） | 输出 |
|---|---|---|---|
| `deepseek-flash` | ¥0.04 / ¥0.02 | ¥2 / ¥1 | ¥8 / ¥4 |
| `deepseek-v4-pro` | ¥0.30 / ¥0.15 | ¥9.0 / ¥4.5 | ¥27.0 / ¥13.5 |

前为高峰价，后为空闲价（正好半价）。高峰 = 北京时间工作日 9:00–12:00、14:00–18:00。
**中国法定节假日未建模**，节假日流量会高估。未知模型按 flash 计价。

面板用一块木牌提示价格：空闲时段显示「今日米价 · 减半」。

## 路由

| 路由 | 鉴权 | 用途 |
|---|---|---|
| `GET /api/rice-bowl/state` | owner | 余额 + 消耗文档 |
| `GET /api/rice-bowl/pulse` | owner | 1.5s 轻量消耗与实时米位 |
| `GET /api/rice-bowl/asset/<name>.webp` | 公开 | 素材（不含账户数据） |
| `GET /api/rice-bowl/ping` | 公开 | 客户端挂载心跳 |
| `GET /api/rice-bowl/diag` | 公开 | 只有计数器，绝不含余额 |

数据路由 fail-closed。自有前缀路由拿不到共享 `/api` 的 peer，因此 Host 在渲染 index 时
签发页面令牌并注入 `__RICE_BOWL_TOKEN__`，客户端回传 `x-rice-bowl-token`。
令牌以 **SHA-256 哈希**落盘（`$DSH_HOME/rice-bowl/tokens.json`，0600），
进程重启或插件重载都不会让已打开的页面失效。

## 隐私

- 本版本**完全不读取 API key**。
- 余额只会通过 owner 授权的路由离开 Host。
- 余额响应缓存 45s，面板轮询不会打爆接口。
- 账本在 `$DSH_HOME/rice-bowl/ledger.json`，只存金额。

## 素材

八个状态由插件所有者提供，见 `assets/ATTRIBUTION.md`。
全部 1024×1024 RGBA，共用同一画布与同一缸体；本插件用**统一裁切** `(74,62,952,962)`
再编码成 512 宽 WebP，从而让 `girl-sleep` 能直接叠在 `vat-empty` 上（上移 15.55%）。

## 未实现

- 多 key 多米缸（逐个勾选 opt-in）。
- 账本里已存的按日历史没有浏览界面。
- 素材是静态帧；动画由 CSS 驱动。若后续提供 GIF/序列帧可替换。

## 安装

```
plugin_manager install_bundle  target: <本目录绝对路径>
```

**客户端改动需要重启 DSH**（浏览器 bundle 在页面启动时加载）。
