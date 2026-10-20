# dsh-plugin-ckzs

个人 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 插件集合。
每个插件都是可独立安装的 bundle，互不依赖。

## 目录结构

```text
.
├── README.md
├── .gitignore
└── plugins/
    └── usage-stats/              # 一个插件 = 一个并列目录 = 一个 bundle
        ├── README.md             # 该插件的数据口径、配置、校验说明
        ├── package.json          # 包名 + dsh.bundle / dsh.client 声明
        ├── cordis.patch.yml      # 安装时插入的 Loader 行
        ├── index.js              # Host 半（可选）
        ├── client.js             # 浏览器半（可选）
        ├── icon.svg
        ├── locale/               # 展示用标题/描述（按语言）
        └── test/                 # 该插件自己的离线校验
```

新增插件时在 `plugins/` 下并列增加目录即可；目录名与包名保持一致，测试跟随插件放在
`test/` 内，避免根目录随插件数量增长。

## 插件

| 插件 | 包名 | 说明 |
|---|---|---|
| [`plugins/usage-stats`](plugins/usage-stats/) | `@an1kano/dsh-usage-stats` | 输入框下方显示账户余额、本月已用金额、当前会话金额与 token 明细 |

## 安装

DSH 的插件安装同时做三件事：把包加入 profile 依赖、把 bundle 加入 profile 的
`dsh.profile.bundles`、应用它的 patch。因此用一条命令完成安装 —— 把下面这句交给 DSH 助手：

```text
plugin_manager install_bundle "git+https://github.com/An1kano/dsh-plugin-ckzs.git#path:/plugins/usage-stats"
```

- `#path:/plugins/usage-stats` 让 pnpm 只拉取仓库中的这个子目录；
- 使用 SSH 或私有 fork 时替换 URL：
  `git+ssh://git@github.com/<owner>/dsh-plugin-ckzs.git#path:/plugins/usage-stats`；
- 也可以先 clone 仓库，再安装本地目录（开发时推荐，改动直接生效）：
  `plugin_manager install_bundle <仓库路径>/plugins/usage-stats`；
- 卸载：`plugin_manager remove_bundle @an1kano/dsh-usage-stats`。

安装后，本地目录安装的改动刷新页面即可生效；Host 半的 JS 改动需要重启 `dsh web`。

## 开发校验

每个插件的 `test/` 都能离线运行（不需要浏览器或运行中的 DSH）：

```bash
node plugins/usage-stats/test/host-check.mjs
node plugins/usage-stats/test/render-check.mjs
```

## 约定

- 仓库内不包含凭据、会话内容、账户余额等个人数据；测试使用合成数值。
- bundle 无构建步骤：`index.js` 是原生 ESM，`client.js` 是浏览器模块。
- 新增插件时同步更新上面的插件表格与对应目录的 `README.md`。
