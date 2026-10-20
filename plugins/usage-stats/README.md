# 余额与用量（@an1kano/dsh-usage-stats）

在 DSH Web 输入框下方增加三个小胶囊：**账户余额**、**本月已用金额**、**当前会话已用金额**。
点开任意一个胶囊会展开明细面板：充值/赠送余额、本月请求数与 token 构成、按模型的金额，以及当前会话的同类统计。

## 安装

一条命令（安装并加入当前 profile 的 bundle 列表），把下面这句交给 DSH 助手执行：

```text
plugin_manager install_bundle "git+https://github.com/An1kano/dsh-plugin-ckzs.git#path:/plugins/usage-stats"
```

`#path:/plugins/usage-stats` 让 pnpm 只取仓库里的这个子目录。也可以先 clone 仓库，再安装本地目录：

```text
plugin_manager install_bundle <仓库路径>/plugins/usage-stats
```

卸载：`plugin_manager remove_bundle @an1kano/dsh-usage-stats`。

## 数据来源

| 指标 | 来源 | 说明 |
|---|---|---|
| 账户余额 | Host `deepseekAccount.getBalance()` | 平台返回的权威数值（充值余额 + 赠送余额） |
| 本月 / 当前会话 token | 会话日志中的 `assistant/message.usage` | 通过 `sessionQuery` 读取所有会话（含持久化会话），按事件时间归入当月 |
| 本月 / 当前会话金额 | token × 官方价目 | **估算值**；高峰时段单价 ×2；未识别的模型按 `deepseek-flash` 计价并标 `*` |

高峰时段按官方规则：北京时间周一至周五 09:00–12:00、14:00–18:00（不含法定节假日；
本插件未内置节假日表，节假日会按高峰计价）。实际扣费请以平台账单为准。

## 可调配置

在 profile 的 `cordis.patch.yml` 中覆盖同名行即可（覆盖会替换整份 config）：

```yaml
- id: usage-stats
  name: '@an1kano/dsh-usage-stats'
  config:
    currency: CNY                 # 无钱包可读时的兜底币种
    accountTtlMs: 60000           # 余额缓存
    usageTtlMs: 20000             # 跨会话用量缓存
    sessionCacheTtlMs: 300000     # 持久化会话折叠缓存
    maxSessions: 200              # 参与“本月”统计的最新会话数
    peakPricing: true             # false = 始终按空闲时段价
    peakMultiplier: 2
    peakTimeZoneOffsetMinutes: 480
    peakRanges: [[540, 720], [840, 1080]]
    pricing:
      CNY:
        deepseek-flash: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
        deepseek-v4-pro: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
```

价目单位是「元 / 百万 tokens」，`cacheMiss` 同时用于未命中缓存的输入和缓存写入。
USD 表同样内置（`pricing.USD`）。

## 实现

- `index.js`：Host 半，注册 `GET /usage-stats/data`（`connection.requestRejection` 鉴权），
  聚合余额、本月与当前会话用量。
- `client.js`：浏览器半，在 `conversation.composer.dock` 注册一个条目，每 20 秒轮询一次。
- 卸载插件即移除路由和条目。

## 校验

不需要浏览器，也不需要启动服务：

```bash
node plugins/usage-stats/test/host-check.mjs     # 聚合、计价、峰谷、鉴权
node plugins/usage-stats/test/render-check.mjs   # 面板渲染分支（中英文、空/错误态）
```

测试夹具全部是合成数值，不含任何真实账户或会话数据。
