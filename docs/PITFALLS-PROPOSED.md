# 建议加入 ~/.agents/AGENTS.md 的踩坑记录

以下 22–36 条来自 Navigator 的几轮（撤销、键盘、手机端、通知、面板、备份、逐字段合并、配对码、筛选、重复与清单、真机联调）实际踩到的坑。
**建议并入 `~/.agents/AGENTS.md` 的「踩过的坑（务必照做）」一节，从 22 开始编号**，格式与那里已有的 1–21 条一致。

这份文件只是待审阅的草稿：`~/.agents/AGENTS.md` 是本地全局文件，这里没有改它。

---

22. 不要对从未挂载的子树用 `computed()`（比如关闭状态对话框里的行列表）：引擎退出时 double free，`nsh test`
    收尾时 SIGSEGV，栈在 `nsh_js::reactive::free_all`。用 `If` / `Each` + 子组件，在绘制处读 data。偶发仍有，已知。
23. `#[module]` 方法不在主线程（`MainThreadMarker::new()` 为 `None`）：AppKit 只能经 `_dispatch_main_q` +
    `dispatch_async_f` 交回主队列；`NSApplication` 在 objc2-app-kit 里要同时开 `NSApplication` 和 `NSResponder`
    两个 feature；没有 bundle 的进程里这些调用一律 no-op。
24. 普通 `View` 的 `ref` 引擎不交出；卡片 `onLayout` 报的是 list cell 内的 frame（恒 `y: 0`）。几何只能沿
    `onLayout` 链读，行位置用 cell 高度累加；无头跑测试时 `List` 的 `ref` 是 undefined。
25. 测试文件不能（哪怕间接）import `app/native`：无头能过，`--target macos` 整份 bundle 失败。纯逻辑与 native
    调用分文件，组件间动作走 props。`#[module]` 方法的目录由界面传入（`""` 即 no-op）；crate 自己的测试别
    `board::open` 全局 store，`OnceLock` 会抢。
26. 键盘：`keymap.bind` 的 `when: "notEditing"` 让方向键 / 回车 / 空格不抢输入框；同一键位后绑定者赢，所以组件
    生命周期内一直绑会压住别处。弹层的键要「打开时绑、关闭时解」。
27. 手势：`panActivation` 一旦激活，外层 scroll 永久拿不回这些触摸；行内整行横滑会废掉分页翻页，要用
    「长按 + 两端窄条」。
28. nsh 测试里测试 bundle 与 app bundle 是两个模块注册表：测试里 `signal.set` 对 app 无效，注入要走 app 启动时
    读的 Storage 键（如 `navigator.backups`）。
29. 系统通知：App 退出后立即重开，`UNUserNotificationCenter` 会无声丢掉已排的请求。启动时不要相信自己的记账，
    要用系统自己报告的列表对账（补排缺的、撤掉多的）。
30. macOS 真窗口测试会抢键盘和焦点，多个子代理并行时要互斥（`mkdir /tmp/nav-macos.lock`）。390 宽的 macOS
    窗口里标题栏会被平台的 title band 盖住，按钮按不到。
31. 就地修改 vs 换对象：启动迁移若给每张卡返回副本再 `cards.set`，所有 `List` cell 重建，拖拽中途的手势直接丢；
    要就地改对象、只换数组。
32. 合并两个并行分支时，语义冲突不会报文本冲突（一边删了图标、另一边还在用）。合并后必须跑 `nsh check` 与全量
    测试，不能只看 `git merge` 有没有冲突。
33. 不要把 `signal.set` 直接当回调传下去（如 `onChange={draftTags.set}`）：脱离自身 signal 调用会抛
    `not a live signal`，控件看着能按却毫无反应。用闭包 `(v) => draftTags.set(v)`。手机捕获 Sheet 的标签与
    截止曾因此在真机上完全无效，而老测试用 `openApp()`（桌面窗口）会提前 return，等于空过——手机用例要用
    `openPhone()`。
34. 测试里不要用固定的 `wait(400)` 等界面更新再断言：机器忙时会偶发失败，且失败与改动无关。用
    `waitFor(<目标元素>)`。
35. `CFFIXED_USER_HOME` 不被 nsh runner 尊重，它用 `$HOME` 拼 `Library/Application Support`。要隔离数据目录就
    `HOME=/tmp/xxx` 运行；隔离前先确认日志里的 `board dir:` 落在隔离目录，别在用户真实目录上试。
36. 测试驱动 `app.drag(selector)` 落指前会把目标判为「被挡住」：目标中心点落在任一祖先 scroll view 边缘 10%
    （上限 48pt）以内，它就去滚动那个 scroll view，反复不收敛则报 `did not come into view`。可拖的目标要么
    大到中心点落在安全区，要么别贴在这圈边上。
