# 懒点小栈 · 微信小程序（bead-pop-miniprogram）

> 本仓库用于备份微信小程序「懒点小栈」源码，并作为**大改前的基线版本**。
> 备份时间：2026-10-16

## 项目结构
- `app.js` / `app.json` / `app.wxss`：小程序入口与全局配置（标题「懒点小栈」）
- `pages/index/`：首页（当前唯一页面，含 `.js/.json/.wxml/.wxss`）
- `components/privacy-popup/`：隐私弹窗组件
- `cloudfunctions/`：云函数（`secCheck` 内容安全校验、`secCheckCallback` 回调）
- `utils/`：工具函数（artkal / brands / export / palette / privacy / processor / security 等）
- `接入内容安全-操作步骤.md`：内容安全接入说明

## 版本控制说明
- 许可证：MIT（见 [LICENSE](LICENSE)）
- `.workbuddy/` 等本地个人数据已在 `.gitignore` 中排除，不会上传
- 远程地址：`https://github.com/ylan4425-oss/git`（**公开仓库**，推上去的代码全网可见）
- 提交作者：仓库所有者账号（`ylan4425-oss`）

## 改坏时如何回退（概要）
1. 改崩了但**还没提交** → `git restore 文件名`（丢弃该文件未提交的改动）
2. 某次**提交**后发现有问题 → `git revert 提交号`（安全回退，保留历史）
3. 想整体回到某个历史版本 → `git reset --hard 提交号`（改写历史，慎用）

> 详细流程见与助手的对话，或运行 `git log` 查看历史提交。
