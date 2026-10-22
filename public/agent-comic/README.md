# 一分钟漫画教你玩转 Agent

这是独立、无需登录的静态漫画学习网站，包含首页、章节目录、漫画阅读器和四话可直接阅读的入门内容。

## 推荐仓库位置
在现有 GitHub 仓库 `free-tools-hub` 根目录新增 `agent-comic/` 文件夹。
请将本 ZIP 的 `agent-comic` 文件夹完整上传到仓库根目录，与 `cloudflare-pages-deploy/` 同级。

## Cloudflare Pages 部署
建议创建**第二个 Cloudflare Pages 项目**（仍连接同一个 GitHub 仓库），而不是修改原情侣计划项目。
- 项目名建议：`agent-comic`（实际 `pages.dev` 地址取决于是否可用）
- Git 仓库：`free-tools-hub`
- Root directory：仓库根目录（留空）
- Build command：留空
- Build output directory：`agent-comic`
- Functions：本网站不需要后端、数据库或环境变量
- 现有情侣计划项目继续使用 `cloudflare-pages-deploy` 作为输出目录，保持原有配置不变。

如果已有根目录 `wrangler.toml` 配置了旧项目的构建目录，应在第二个项目中核实构建配置是否被覆盖；最安全的是为新项目明确设置输出目录为 `agent-comic`。

## 编辑漫画
打开 `agent-comic/comics/chapters.json`，每话包括 `id`、`title`、`sub`、`emoji`、`theme` 和 `panels`。
每格漫画为四项数组：`[场景表情, 小标题, 对话, 解说]`。
本版采用轻量「表情符号漫画」风格，方便直接部署，不依赖外部图片或 CDN。以后可以把场景升级成原创插画图片。

## 测试
不要双击 `index.html` 直接使用 `file://` 打开，因为浏览器通常禁止从文件协议读取 JSON。
可以用 Python 本地预览：`python -m http.server 8000 --directory agent-comic`，再访问 `http://localhost:8000/`。

此版本为纯静态网站，不会接触 Supabase，也不会改动现有情侣计划网站数据。
