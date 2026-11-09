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

### Android APK：用脚本，不要直接 `nsh package`

```bash
scripts/build-android.sh          # 仓库根目录执行；产物 app/.nsh/out/Navigator.apk
```

脚本只做两件事：只打 `arm64-v8a`，并给 release profile 加 `LTO=fat`、`codegen-units=1`、`opt-level=z`。
同一份源码量过：默认 `nsh package --target android`（双 ABI、无 LTO）78.1 MB → 只出 arm64 46.2 MB → 脚本 26.0 MB。

- **参数为什么走环境变量**：`.nsh/rust/` 是 nsh 生成的工作区，每次运行都会重写 `Cargo.toml`，写进去会被覆盖；`CARGO_PROFILE_RELEASE_*` 由 Cargo 自己读，绕开了这一层。
- **不要加 `CARGO_PROFILE_RELEASE_PANIC=abort`**：能到 22.7 MB，但 nsh 用 `catch_unwind` 把组件 panic 变成可显示的错误（`nsh-core` 的 `element/component.rs`），abort 会把「显示错误」变成「进程退出」。
- 大头是 `.text`：30.6 MB → 12.9 MB。省下的是每个 crate 各自复制一份的泛型实例化，不是压缩。
- `opt-level=s` 是退路（30.9 MB），只有真机上觉得 `z` 慢才换；`z` 与 `s` 差 6.4 MB，不是无关紧要的抖动。
- 只发 arm64，是因为 minSdk 28（Android 9）之后在用的设备几乎都是 arm64；代价是 32 位的 Android Go 装不了。需要 32 位就自己跑 `nsh package --target android --abi armeabi-v7a`，体积会回去。

### 发版

1. 改 `app/nsh.json` 的 `version` 和 `build`：`build` 必须是没发布过的新数字，App 只装比当前 build 大的 OTA 包（版本号不参与比较）。
2. `scripts/build-android.sh` 出 APK；`scripts/ota-release.sh --build N` 出 `dist/*.nshpkg`、`dist/latest.json`、`dist/latest.json.sig`。
3. 传 Release：三个 OTA 文件加 APK 一起，标题用 `Navigator {version} (build {build})`，tag 沿用 `v{version}-{build}`。必须是正式发布，不能 draft / prerelease——App 读的是 latest。

- 签名私钥在仓库外（`~/.navigator-ota/`），任何 `.secret` 都不提交。
- OTA 只换 TSX/图片/字体；Rust crate、runtime、权限或 manifest 的改动需要新的 APK。
- 界面上的版本号来自 `app/updates.ts` 的 `runningLabel()`：正在跑的 OTA 包优先，没有包时用 shell（APK）的 version/build，格式 `0.1.6 (build 7)`。
- **发版由用户本机完成**（编译、打 tag、传 Release）；agent 不要代为推送 tag 或创建 Release。
- 没有 CI：`.github/workflows/ota.yml` 已删除，推 tag 不会自动发版。APK、OTA 包、Release 和 macOS 的 `.app`（`nsh package --target macos`）都在本机做。
- 全量测试只在打包/发版前跑，不要每改一行都跑。

## 其他

- 先读 `DESIGN.md` 再动界面；`DESIGN.md` 与现有代码冲突时，以用户这次的要求为准，并同步更新文档。
- 用户的时间优先：能用一个测试文件说明问题，就不跑十个。
