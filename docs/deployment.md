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

`site-entry/index.html` 中的正式应用链接与代码仓库链接是公开地址，不是密钥。更换正式域名时修改这两个入口链接。Pages 的 `/history` 不承载历史记录；「查看我的历史」直接打开正式应用的 `/history`。

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

`npm test` 使用真实 API 代码、全部迁移和 SQLite，模拟 D1 的事务接口；它不等同于 Cloudflare 的网络和资源限额测试。发布还需要验证构建后的真实 Worker 和页面。完整审查见 [审计报告](security-audit.md)。

当前依赖扫描保留 Drizzle 开发工具链中的 4 个中等级联告警，源头是其旧版 esbuild 开发服务器；应用及迁移生成不调用该服务器。未使用强制降级来隐藏告警。CI 拒绝新增 high/critical 告警，并继续显示中等告警。

## 目录与用户名维护

应用源码集中在 `src/`，GitHub Pages 发布目录为 `site-entry/`，文档位于 `docs/`。根目录保留构建工具默认读取的配置；`drizzle/` 保留在根目录供 Sites 打包迁移。

`0011` 为昵称偏好增加标准化键和版本，并用 SQLite 触发器原子同步投票昵称、带饭登记版本和饭局版本。带饭原始请求字段保持不变，展示名称查询当前个人昵称。昵称冲突会回滚整次更新；旧迁移不能改写。

## 可选账号登录

正式网站复用 Sites 已配置的 ChatGPT 登录，`/signin-with-chatgpt`、`/signout-with-chatgpt`、回调与认证会话由平台处理。前端使用普通顶层链接，不自行请求 OAuth 授权接口。没有新增密码库、邮件服务或微信登录。

`0012` 只增加 `account_links` 与所有者唯一索引。账号关联在第一次经过可信网关认证时创建，原有记录主键、请求指纹和迁移保持不变。同一账号跨设备映射到同一个数据所有者；同一游客身份最多绑定一个账号。原游客 Cookie 在绑定后不能在退出状态访问账号权限。

`src/lib/visitor-identity.ts` 仅在当前 Sites 正式域名及 localhost 测试入口信任平台身份头；其他域名会忽略这些头并隐藏登录链接。独立部署必须先配置能验证身份且剥除外来同名头的可信认证网关，再显式接入，不能直接放开域名判断。邮箱只作为本人账户信息显示，不保存到公开成员记录。

`X-Fandian-Identity` 是不可用于登录的界面身份标记，已登录写入需要匹配当前身份，防止其他标签页切换账号后旧表单误提交。客户端有序建立首次身份，并在身份变化时清除旧身份草稿、刷新页面。浏览器拒收 Cookie 时限制自动刷新，避免无限重载。

## 菜单图片存储

`.openai/hosting.json` 保留原有 `DB`，新增逻辑 R2 绑定 `BUCKET`。`0013` 只增加图片元数据表及餐馆、候选快照的菜单编号 JSON 列，已有餐馆与饭局默认为空菜单。部署前打包这些迁移；不要把图片、数据库或本地 R2 状态放进 GitHub。

`POST /api/menu-images?request=<UUID>` 接收单张图片原始字节，沿用同源及登录身份校验。服务端按实际读取字节限制 5 MB，核对 JPG/PNG/WebP 容器标识，固定返回可信 MIME 与 `nosniff`。图片请求编号与所有者共同确定上传编号，内容指纹约束重试；先预留记录、存储成功后标记就绪，餐馆保存事务只接受已就绪且本人未发布或已公开的图片。

每个身份最多保留 12 张未保存图片、滚动 24 小时最多上传 40 张。上传时清理超过 24 小时的未保存预留（每次最多 50 条），已发布图片保留用于餐馆恢复、旧饭局和重开饭局。该限制面向普通重复操作，游客可换身份，不能代替托管层的流量限制。R2 失败会保留前端文件并允许重试；未使用临时签名链接，因此历史菜单不会因链接过期而失效。

若迁移到自管 Cloudflare，还需创建 R2 桶并绑定为 `BUCKET`；完整迁移需要同时复制 D1 元数据和 R2 `menus/` 对象，不能只迁移数据库。

## 餐馆池、最新菜单与取餐安排

`0014` 新增个人 `restaurant_pools`、按饭局及带饭人区分的 `pickup_plans`，以及候选的可空餐馆外键、餐馆资料更新时间。迁移不回写旧候选，也不改变旧图片或饭局状态。最新菜单 GET 必须给出可访问饭局中的候选编号；旧候选只接受唯一的名称、类型、地址匹配。

餐馆池保存使用身份隔离、创建请求指纹、版本条件及有效餐馆检查；软删除防止旧创建请求恢复已删除组合。取餐安排写入在同一原子条件中核对饭局未结束、本人仍有认领以及安排版本。游客数据和已绑定账号使用现有身份映射，不接受请求参数指定他人身份。

未提交带饭草稿只写入当前标签页的 `sessionStorage`，沿用身份切换清理规则；正式登记继续使用原有幂等提交与版本检查。复制群通知只读最新饭局，不调用微信接口。


## 下单、通知和定时投票

`0015` 增加 `orders.purchase_status/issue_note/change_request`、`rooms.voting_deadline_at` 及个人 `notifications` 表。现有登记默认尚未记录下单状态，原认领和带回状态不变。订单与取餐安排的 SQLite 触发器在同一事务中写入更新；昵称触发器不额外生成下单通知。通知按所有者过滤，已读更新使用客户端已见的最大编号，避免读掉并发产生的新通知。

改单申请和处理全部校验订单版本、当前所有者／认领人及数据库执行时的带饭期限。已下单认领不能直接退回；售罄或待确认申请不能被标记带回。复制汇总先刷新服务端数据；聚合只按确切的菜名和完整备注，不推测口味或过敏原相同。

投票到期采用访问时原子结算：饭局、首页及历史读取前结算对应到期记录，投票插入和提前关闭在数据库执行时再次检查截止。无人访问时不运行独立定时任务；下一次访问按固定截止时刻结算，关闭浏览器不会延长投票或带饭期限。页面倒计时到期立即读取结果，断网则保留到期提示并等待连接恢复。香槟时间转换按 America/Chicago 校验，拒绝夏令时切换中不存在或有歧义的时间。
