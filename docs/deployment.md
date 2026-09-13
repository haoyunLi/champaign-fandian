# 发布与维护

## 当前发布结构

- GitHub 仓库保存完整 React 页面、Worker API、D1 结构与迁移、测试和发布入口。
- GitHub Pages 只发布 `site-entry/` 中的 HTML、CSS 和图片，提供进入饭点及历史记录的链接。
- 现有完整应用继续运行于 `https://champaign-fandian.haoyun963.chatgpt.site/`，保留原来的数据库及浏览器身份。
- Pages 不读取投票数据，不存储昵称或带饭备注，也不通过跨站 Cookie 访问 API。

GitHub Pages 是静态托管，不能执行本项目的 Worker API 或 D1 查询。不要直接发布 `dist/client`：它仅包含构建资源，没有完整页面。

## 本地运行

安装 Node.js 24 后，在仓库目录运行：

```sh
npm run install:ci
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm run build
npm run db:migrate:local
npm start
```

打开终端显示的本地地址。初始餐馆在第一次 API 访问时写入本地数据库。迁移工具固定使用 `--local`，不会访问生产数据库；重复运行会跳过已经应用的迁移。本地数据库保存在忽略的 `.wrangler/state/`。

数据库已经通过其他工具手动建表时，不要盲目再次应用初始迁移；先备份，核对迁移账本。测试使用内存 SQLite，另行验证 Worker 时可使用独立状态目录：

```sh
npm run db:migrate:local -- /tmp/fandian-test-state
node --import ./scripts/sites-env.mjs node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --persist-to /tmp/fandian-test-state \
  --ip 127.0.0.1 --port 8788 --inspector-port 0
```

## GitHub Pages

仓库 Settings → Pages 中选择 **GitHub Actions**。默认分支 `main` 的工作流会先安装锁定依赖、检查类型与代码、运行测试、安全扫描、生产构建，并两次执行本地迁移；全部成功后才发布 `site-entry/`。拉取请求只运行检查，不发布。

`pages/index.html` 中的正式应用链接与代码仓库链接是公开地址，不是密钥。更换正式域名时修改这两个入口链接。Pages 的 `/history` 不承载历史记录；「查看我的历史」直接打开正式应用的 `/history`。

## 维护现有后端

现有后端通过 Sites 的版本发布流程更新，GitHub 推送不会自动更新正式投票应用。发布时将锁定依赖构建出的 Worker、静态资源和 `drizzle/` 迁移一起发布；保持 `.openai/hosting.json` 中已绑定的项目身份，避免新建空数据库。

已有迁移不能改写。结构变更应修改 `src/db/schema.ts`，执行 `npm run db:generate`，审查新增迁移并在独立数据库中测试，再随版本发布。`0009` 新增可为空的登记请求指纹，`0010` 新增已取消请求编号表，均保留已有记录。

不要将 `.env*`、`.dev.vars*`、`.wrangler/`、数据库导出、Cookie、访问令牌或部署凭据提交到 GitHub。调试输出也不要包含这些数据。密钥仅设置在托管平台或 GitHub 环境的 secrets 中。

## 以后迁移到自管 Cloudflare

仓库中的业务 API 本身支持 Cloudflare Workers/D1。构建配置里的数据库 ID 是本地占位符，不能直接拿来部署到自己的账户。

1. 在自己的 Cloudflare 账户创建 D1 数据库；保留 `DB` 绑定名，使用实际数据库 ID。
2. 生成生产构建后，复制 `dist/server/wrangler.json` 为一个忽略的本地部署配置，将 `main` 和 `assets.directory` 指向构建文件，填写实际数据库 ID，并把 `migrations_dir` 指向仓库 `drizzle/`。
3. 对**新建的空数据库**运行 `wrangler d1 migrations apply DB --remote --config <自己的配置>`，再运行 `wrangler deploy --config <自己的配置>`。部署前先查看 diff 和 dry-run。
4. 如果需要保留现有数据，先使用原托管平台支持的备份/导出，再设计迁移；GitHub 源代码不含生产数据。浏览器身份 Cookie 绑定原域名，换域名也需要身份迁移方案。

此流程会创建新的托管资源，当前发布没有执行它，也没有迁移生产数据。

## 安全检查的范围

`npm test` 使用真实 API 代码、全部迁移和 SQLite，模拟 D1 的事务接口；它不等同于 Cloudflare 的网络和资源限额测试。发布还需要验证构建后的真实 Worker 和页面。完整审查见 [审计报告](../security-audit.md)。

当前依赖扫描保留 Drizzle 开发工具链中的 4 个中等级联告警，源头是其旧版 esbuild 开发服务器；应用及迁移生成不调用该服务器。未使用强制降级来隐藏告警。CI 拒绝新增 high/critical 告警，并继续显示中等告警。

## 目录与用户名维护

应用源码集中在 `src/`，GitHub Pages 发布目录为 `site-entry/`，文档位于 `docs/`。根目录保留构建工具默认读取的配置；`drizzle/` 保留在根目录供 Sites 打包迁移。

`0011` 为昵称偏好增加标准化键和版本，并用 SQLite 触发器原子同步投票昵称、带饭登记版本和饭局版本。带饭原始请求字段保持不变，展示名称查询当前个人昵称。昵称冲突会回滚整次更新；旧迁移不能改写。
