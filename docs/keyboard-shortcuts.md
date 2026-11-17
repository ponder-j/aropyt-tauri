# macOS 快捷键核对（2026-10-31）

核对范围包括原生菜单、编辑器捕获处理、CodeMirror 默认键位、表格单元格、查找输入框和右键提示。自动检查覆盖菜单、编辑器与表格合计 72 个不同组合，并验证 Windows/Linux 的既有绑定。

依据：[Apple 的 Mac 键盘快捷键](https://support.apple.com/en-us/102650)。Finder、Safari 等应用仅在自身激活时生效的命令不视为系统级占用；保存、复制、字体格式等同义原生操作沿用 macOS 习惯。

| 操作 | 原 macOS 绑定 | 修正后的绑定 | 原生冲突或调整原因 |
| --- | --- | --- | --- |
| 查找 | Command+F（也误接受 Control+F） | Control+F | 按用户选择使用物理 Control |
| 替换 | Command+H（也误接受 Control+H） | Control+H | Command+H 隐藏应用 |
| 下一个 / 上一个匹配 | F3 / Shift+F3 | Command+G / Command+Shift+G | 避开 Mission Control / 功能键，遵循原生查找习惯 |
| 快速打开 | Command+P | Control+Shift+O | Command+P 打印 |
| 打印 | Option+Shift+P | Command+P | 恢复原生打印快捷键 |
| 引用块 | Command+Shift+Q | Control+Shift+Q | 退出登录 |
| 行内代码 | Command+Shift+反引号 | Control+Shift+反引号 | 切换到上一个应用窗口 |
| 大纲 / 文件列表 / 文件树 | Command+Shift+1 / 2 / 3 | Control+Shift+1 / 2 / 3 | 文件树占用截图；统一这一组视图键位 |
| 专注 / 打字机模式 | F8 / F9 | Control+Shift+8 / 9 | 避开媒体功能键及可配置的系统功能键 |
| 全屏 | F11 | Control+Command+F | F11 显示桌面；使用同义原生全屏组合 |
| 切换标签页 | Command+Tab | Control+Tab | Command+Tab 切换应用 |
| 开发者工具 | Shift+F12 | Command+Option+I | 避开功能行；采用 Web Inspector 常用组合 |
| 重做 | 菜单 Command+Shift+Z，查找框还接受 Command+Y | Command+Shift+Z | 统一原生重做组合 |
| 粘贴为纯文本 | Command+Shift+V | Command+Option+Shift+V | 对齐原生粘贴并匹配样式 |
| 删除线 | Option+Shift+5 | Control+Shift+5 | 避开 Option 组合输入特殊字符 |
| 移动表格行 / 列 | Option+方向键 | Control+Command+方向键 | 保留单元格中原生的按词 / 段落移动 |

按用户明确选择，Control+F / Control+H 在文稿与表格内覆盖原生的向右移动 / 退格；查找面板内可用这两个组合切换查找和替换。其他普通输入框继续使用原生文本操作。Command+H、Command+Tab、Command+Shift+Q、Command+Shift+反引号和截图组合不再触发编辑命令。

Control 与 Command 独立匹配，包括同时按下这两个键的情况。表格内的 Control+A 不再被误当成 Command+A；Control+B 等文字移动不再触发 Command 的格式命令。移除 CodeMirror 对 Control+方向键的映射，避免占用 Mission Control / 桌面切换；也移除其改变原生 Control+L、Control+Shift+A 语义的映射。

CodeMirror 的 Option+上下方向键不再移动或复制整行，保留原生按段落移动与选择；也移除其 Option+Shift+M 和 Control+Option+H 默认扩展。文稿及表格中的链接使用 Command+单击，Control+单击保留为 macOS 辅助点击。鼠标缩放使用 Command，避免接管 Control+滚轮辅助功能缩放。

自定义 `keyBinding` 为兼容既有配置，`Ctrl` / `CommandOrControl` / `CmdOrCtrl` 继续表示平台主修饰键（macOS 上为 Command）。`Control` 明确表示物理 Control；`Command` / `Cmd` / `Meta` 表示 Command。例：`"replace": "Control+H"`。用户自己设置的自定义组合优先于默认值。

验证命令：`node tools/shortcuts-test.mjs`、`npm run typecheck` 和真实应用 WebView 回归 `node tools/test-tauri.mjs --packaged`。原生菜单检查额外核对 Control/Command 修饰位以及显示提示。
