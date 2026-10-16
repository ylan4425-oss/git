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

## 已实现的功能改进（experiment 分支）

> 基线：`7e30c4b`（大改前完整版）。以下改动均在 `experiment` 分支独立提交，尚未合入 `main`。

1. **品牌辨认色号（#1）** `0a9e691`
   - 品牌辨认弹窗中，每个代表色底部显示该品牌的色号（如 Artkal 的 `S01`），
     用户可对照商家给的色号直接确认品牌，不用在选色上浪费时间。
2. **Hama / Nabbi 色库补充（#3）** `2154c1f`
   - 接入 [craft-color-codes](https://github.com/makebead/craft-color-codes) 数据源：
     Hama Midi 5mm 共 92 色、Nabbi BioBeads 5mm 共 30 色，已注册到品牌表。
   - 当前支持 4 个品牌：Artkal(S)、MARD、Hama、Nabbi。
3. **坐标分隔优化（#2）** `316dea5`
   - 单图带坐标网格：底板分隔线加粗至 3px 深黑，每块板左上角加白底「板N」角标，
     分隔/裁剪边界更醒目，降低拼错概率。
   - 逐板导出：按 29×29 底板切片，每块单独生成带标题（全局列范围）与板内局部坐标轴
     （A~列 / 1~行）的图片，依次存入相册，方便分板对照拼装。
   - **多页 PDF（#4）按你的要求不在小程序里实现**，延后到后续桌面软件再做。

## 版本控制说明
- 许可证：MIT（见 [LICENSE](LICENSE)）
- `.workbuddy/` 等本地个人数据已在 `.gitignore` 中排除，不会上传
- 远程地址：`https://github.com/ylan4425-oss/git`（**公开仓库**，推上去的代码全网可见）
- 提交作者：仓库所有者账号（`ylan4425-oss`）

## 分支约定
- `main`：稳定基线（大改前完整版 `7e30c4b`）
- `experiment`：功能改进试验分支（#1/#2/#3 已提交，待你确认后合并/推送）

## 改坏时如何回退（概要）
1. 改崩了但**还没提交** → `git restore 文件名`（丢弃该文件未提交的改动）
2. 某次**提交**后发现有问题 → `git revert 提交号`（安全回退，保留历史）
3. 想整体回到某个历史版本 → `git reset --hard 提交号`（改写历史，慎用）

> 详细流程见与助手的对话，或运行 `git log` 查看历史提交。
