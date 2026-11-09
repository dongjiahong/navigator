# AGENTS.md

## 项目

Navigator 是一个 nsh App：TSX 界面在 `app/`，同步、SQLite、通知等原生部分在 `app/src/lib.rs`。
命令默认在 `app/` 下执行。界面和交互的约束见 `DESIGN.md`，产品约束见 `PRODUCT.md`。

## 测试要求

用户明确要求：**不要每次改动都跑全量测试，只测试有必要的地方；更多反馈来自用户实际使用。**
测试是为了抓住这次改动可能弄坏的东西，不是为了刷覆盖率，也不是每次交付的固定仪式。

默认只做这些：

1. 改了 TSX 或 Rust：`cd app && nsh check`。这是最便宜的一层，改了就值得跑。
2. 改了具体行为：只跑覆盖它的测试文件，例如 `nsh test Phone.test.tsx`、`nsh test Palette.test.tsx`。
   一个行为至少有一条针对它的验证；已有测试优先复用。
3. 只改文档、注释、文案、截图：不跑测试。
4. 纯样式微调：看需要跑 `nsh check`，不必新增测试。

只有这些情况跑全量 `nsh test`：

- 打包 APK 或发 OTA 之前；
- 改了跨模块共享逻辑，例如 `data.ts`、`merge.ts`、`sync.ts`、`deadline.ts`、`reminders.ts`；
- 用户明确要求。

不要做：

- 为同一个改动反复跑全量测试；
- 为追一次偶发失败连续重跑全量：先看失败点，修完只重跑那个文件，最后最多再全量一次；
- 为纯文案、纯样式新增测试；
- 每次改动都启动 Android 模拟器。只有通知、权限、原生手势、安装包行为等无头测试覆盖不到的地方才上模拟器；
- 在报告里把“跑过某个测试文件”说成“全量通过”。只报告实际跑过的命令和结果。

## 打包与 OTA

- Android APK：`cd app && nsh package --target android`，产物是 `app/.nsh/out/Navigator.apk`。
- OTA 包：`scripts/ota-release.sh --build N`，产物在 `dist/`。
- 签名私钥在仓库外（`~/.navigator-ota/`），任何 `.secret` 都不提交。
- OTA 只换 TSX/图片/字体；Rust crate、runtime、权限或 manifest 的改动需要新的 APK。
- 全量测试只在打包/发版前跑，不要每改一行都跑。

## 其他

- 先读 `DESIGN.md` 再动界面；`DESIGN.md` 与现有代码冲突时，以用户这次的要求为准，并同步更新文档。
- 用户的时间优先：能用一个测试文件说明问题，就不跑十个。
