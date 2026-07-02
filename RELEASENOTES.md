# Release Notes

## v0.9.1 (2026-07-02)

### 新功能

- 白名单配置 - data/whitelist.txt 可限制服务器模式允许访问的目录，支持注释行、子目录自动放行，前端显示可选目录按钮
- 网页全屏按钮 - 顶部 header 栏新增全屏按钮（documentElement.requestFullscreen），所有页面可用，适合 Android 手机
- Apple PWA 安装 - 新增 manifest.json 和 Apple 相关 meta 标签，iOS Safari 可添加到主屏幕作为独立 App
- 文件夹树拖拽移动 - 左侧文件夹树支持拖拽文件夹到其他文件夹上完成移动，后端新增 move-folder 端点
- 封面时间记忆 - 每个文件夹的封面截取时间保存到后端 thumb-times.json，重新打开自动加载对应秒数的封面
- 切换文件夹停止播放 - 点击左侧文件夹时自动停止当前视频播放再切换
- HTTP 安全上下文提示 - local 模式在 HTTP 下显示详细说明，提供 localhost、服务器模式、GitHub 下载三种解决方案

### 改进

- 手机端搜索框宽度改为 flex:1，占满标题和菜单按钮之间的空间
- F1 快捷键改为 F4，避免与 Chrome 帮助冲突
- 视频转换按钮移到卡片右键菜单，取消文件大小限制
- 片段导出修复：-ss 放在 -i 前面，解决导出黑屏问题；exec 改为 execFile 防止路径注入
- 删除文件后自动刷新列表
- 服务端删除接口增加流追踪和异步清理，改善 Windows UNC 路径的文件锁定问题
- 手机端：顶部按钮合并到下拉菜单、禁止双击缩放、全屏播放时显示正确文件名
- 封面时间滑块拖动时防抖保存到后端（500ms）

### 修复

- 片段导出视频黑屏（ffmpeg 参数顺序）
- uploads/trimmed 目录缺失导致导出报错
- 删除文件后 UI 不更新
- HTTP 下 local 模式缺少详细错误提示

## v0.9.0

初始版本
