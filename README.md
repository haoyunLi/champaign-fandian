# 饭点 · 香槟吃什么

和群友一起选餐馆，也能帮去不了的人带一份饭。

**[打开饭点](https://champaign-fandian.haoyun963.chatgpt.site/)** · [查看历史](https://champaign-fandian.haoyun963.chatgpt.site/history) · [GitHub Pages 入口](https://haoyunli.github.io/champaign-fandian/)

## 怎么用

1. 设置群昵称，选几家餐馆，发起「自主投票」或「随机抽签」。
2. 把链接发到微信群，大家打开参与；有票后，任何人都可以确定餐馆。
3. 需要带饭的人登记菜品，朋友认领并标记已带回。开始下单后可以停止加单。

页面会显示发起人、投票人的昵称，以及谁登记、谁来带、哪些已经带回。点击顶部用户名可修改自己的昵称，相关记录会同步更新。首页可继续饭局，历史中可找回记录或再来一局。

## 文件放在哪里

| 目录 | 内容 |
| --- | --- |
| [`src/app/`](src/app/) | 网站页面；`api/game/` 是投票和带饭后端 |
| [`src/components/`](src/components/) | 用户名、成员、带饭清单及界面组件 |
| [`src/lib/`](src/lib/) | 饭局规则、时间、类型和公共逻辑 |
| [`src/db/`](src/db/) · [`drizzle/`](drizzle/) | 数据库结构与迁移 |
| [`src/worker/`](src/worker/) | 网站服务入口 |
| [`src/hooks/`](src/hooks/) · [`src/vendor/`](src/vendor/) | 界面工具与第三方样式 |
| [`public/`](public/) | 正式网站的图片与图标 |
| [`site-entry/`](site-entry/) | GitHub Pages 静态入口 |
| [`tests/`](tests/) | 自动检查与测试用数据库 |
| [`scripts/`](scripts/) · [`build/`](build/) | 本地运行和发布工具 |
| [`docs/`](docs/) | 功能、维护和审计说明 |

根目录只保留项目说明、依赖清单及工具要求的配置文件。实际投票、昵称和带饭数据存储在正式网站数据库，不在 GitHub 仓库里。

## 开发与维护

需要 Node.js 24。

```sh
npm run install:ci
npm run build
npm run db:migrate:local
npm start
```

[功能与使用规则](docs/features.md) · [运行与发布说明](docs/deployment.md) · [审计报告](docs/security-audit.md)

GitHub 保存完整代码，并发布一个静态入口。投票和带饭继续使用上方的正式网站。

## 身份与分享

使用同一浏览器可记住昵称和参与记录。昵称不是登录账号，更换设备或清除浏览器数据后，不能仅凭昵称找回原身份。每个人只能修改自己的昵称。

持饭局链接的人可以查看该轮昵称、投票和带饭备注。此工具只协调带饭，不向餐馆下单、扣费或自动发送微信消息。
