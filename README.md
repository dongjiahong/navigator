# 领航 · Navigator

一个 Mac + Android 的原生看板：四列（待办 / 进行中 / 已完成 / 归档），卡片有标题、标签、备注和截止时间。Mac 和手机都能编辑，两边实时同步。

技术栈是 [Native Shell (nsh)](https://nsh.dev)：界面用 TSX，同步服务用 Rust，编译成各自平台的原生视图，没有 WebView。

窗口不保留系统标题栏：`currentWindow().set({ titleBar: { style: "hidden", height } })` 让 App 顶到窗口上沿，地面的渐变一直画到交通灯底下，整条可拖动移动窗口。平台的标题条区域仍然吃掉那一条上的点击——画在上面的按钮看得见、按不到——所以头条分两段：`titleSpacer()` 先让出平台自留的高度，下面 38pt 才是 App 自己的控制（`headerHeight()` 把两段加起来交给 title bar 设置，也用它对齐「领航」和「新建」）。留下一条原生 App 没画的系统栏，看起来就像浏览器里的网页。

## 界面上的几条硬规矩

- **看板不横向滚动。** 四列随窗口变宽，到 `COL_MAX` 就不再长，多出来的空间把整排居中。窗口有下限（`MIN_WINDOW` = 1106，四列到 `COL_MIN` 的宽度）；nsh 没有设最小尺寸的 API，所以用一个 `effect` 在窗口掉到下限以下时把它拉回来。
- **卡片是浮起来的，不是挤出来的。** 点开一张卡，它浮在窗口正中（`min(560, 窗口宽 - 80)` × `min(720, 窗口高 - 96)`，`shadowLift`），四列宽度一点不动；早先它是挤在右边的一列，一打开卡看板就重排，手指刚点的那个位置就换了东西。
- **没有滚动条。** 所有 `Scroll` / `List` 都写 `scrollbar={false}`：一页纸边上出现一条系统画的长条，是 App 没画的界面。
- **标签是用户的数据。** 标签有名字和五种色相（蓝色相由深到浅都在调色板里定义了两遍），在标签管理器里改名、换色、删除；删除会从所有卡片上取下，并且和卡片一样按 `updatedAt` 同步、留墓碑。
- **截止有具体时间，也有日历。** 今天 / 明天 / 下周 只改日期，时间留着不动；点时间胶囊打开 App 自己的时间选择器：24 个小时格加 12 个五分钟格，拇指点两下就选完，不再对着 `TimeField` 的时分段敲键盘；“现在”保留当前分钟。日历面板选任意一天（`Calendar` 自己画出星期几和月份，因为 nsh 的 `Calendar` 不画任何字，而且它的弹层在这个引擎里是透明的）。卡片上永远显示到分钟。
- **删除不再先问，而是可以撤销。** 删卡、完成、归档都会在底部出一条一行提示（`UndoToast`：纸色填充——Mac 用 `card`、手机用 `select`——`shadowLift`、无边框，Mac 居中在窗口底、手机在「添加」按钮上方），6 秒、一次一条；按「撤销」把卡写回去，连它原来的列内位置也还回来。卡片本身是墓碑，撤销就是一次 `deleted: false` 的普通写入。**标签删除仍然先问**——它会把用户没在看的卡片上的标签一起摘下；清空归档、清除示例数据这类批量操作也先问，并在平台原生 `AlertDialog` 里点名数量。
- **整张卡就是把手。** Mac 上没有单独的拖拽把手：按住卡移动 5pt 就把它拎起来（跨列、跨位置），按住不动就是点开。拖到列顶或列底 48pt 以内会自动滚动，越靠边越快。键盘做同样的事：方向键走卡，回车打开，空格完成/恢复，`Cmd+]` / `Cmd+[` 换列，`Cmd+K` 命令面板，`Cmd+F` 跳到搜索框，`Cmd+N` 新建。
- **筛选是本机的视图，不是看板的数据。** 标签可以多选（命中任一即可）、日期条件三选一（今天 / 已逾期 / 无日期），再叠一个搜索框（标题、备注和标签名都能搜）。三者一起收窄，数量始终是整个看板的数。筛选状态只活在各自设备的进程里，不跟着同步走。
- **截止会提醒。** Mac 上是一条真正的系统通知（Rust 侧直接走 `UNUserNotificationCenter`，带系统通知音，App 退出后照样送达）；手机在 App 打开时也能发真正的系统通知（nsh main 的 `Notifications`，APK 现在带 `POST_NOTIFICATIONS`），点通知会打开那张卡；没有权限或平台发不了时，退回列表上方的横幅。App 关闭后手机仍然不会到点唤醒。

---

## 提醒（截止时间的通知）

nsh 0.4.0 没有任何通知 API。App 现在把 nsh 固定到 main 的 `36b9168`（nightly）：Mac 的**定时**通知仍写在 Rust crate 里（`app/src/lib.rs` 的 `Reminder`），手机用 nsh 新增的 `Notifications` 发**立即**通知（`app/reminders.ts`）。

**Mac：走系统通知中心。** `UNUserNotificationCenter` 按卡片 id 建请求，触发时间是「距现在多少秒」，内容带标题、备注摘要和 `UNNotificationSound::defaultSound()`——声音是用户在「系统设置 → 通知 → 领航」里选的那个，不是 App 自己塞的文件。调度权交给系统之后，App 退出、关机重启都不影响送达。被系统拒绝时（没授权）走 `status()` 回报 `denied`，界面不会假装通知过。

- 只有「还没做完 + 有截止 + 截止在未来」的卡才排期；完成、归档、删除即时撤销。
- 同一张卡改了截止或标题会以同名 id 覆盖，不会堆两条。
- 已经过期的截止不排期：过期的卡在板上已经显示红色的「已逾期」，再推一条通知是噪音。
- 测试用 `Reminder.pending()` 读回系统真正持有的请求，断言的是系统状态而不是 App 自己的记账。
- **提前提醒是同一张卡的第二条通知。** id 是 `navigator.card.<id>.pre`，触发在截止前 N 分钟；N 是本机设置（`Storage` 键 `navigator.leadMinutes`，默认 0 即关闭，可选 5 / 15 / 30 / 60），只在 Mac 上，不随看板同步。入口在命令面板（`Cmd+K` 搜「提前提醒」），换了 N 之后所有卡的这两条通知立即重排。
- **通知上带两个动作。** 注册在自己的 category（`navigator.reminder`）里：「完成」和「推迟 1 小时」，点通知本体则打开这张卡。系统把回答记在队列里，Rust 侧 `Reminder.takeResponses()` 轮询取回，界面按一次普通写入处理。**这三条交互（两个动作按钮、点本体打开卡）没有人工点过**——本机拿不到可用的通知点击授权，行为以测试为准。
- **启动后要对账。** App 退出后立刻重开时，`UNUserNotificationCenter` 会无声丢掉一部分已经排好的请求，所以启动后不只相信自己的记账：`Reminder.pending()` 读回系统实际持有的 id，缺的补排、多的撤掉。

**Android：App 打开时能发系统通知。** nsh main 增加了 `Notifications`，`nsh package` 在 App 可以通知时会往 manifest 写 `POST_NOTIFICATIONS`（不声明 `capabilities` 的独立 App 默认拥有这项能力）。`reminders.ts` 在 Android 上读取/请求通知权限；App 每 20 秒检查一次「五分钟内刚到期」的卡，有权限就发一条 `id` 为 `navigator.card.<卡片 id>` 的系统通知，标题是「到时间了：…」，点通知会打开手机的卡片详情页。权限被拒或平台发不了时，仍然退回列表上方的横幅（「打开」/「知道了」）。手机「连到 Mac」Sheet 里新增了「通知」一栏：一行显示当前权限状态，旁边「测试」按钮会请求权限并发一条「通知测试」，不用等到某个截止时间。

**通知开关是灰色时先确认安装包。** 本仓库打出的 `0.1.6 (build 7)` APK 的 manifest 里同时有 `INTERNET` 和 `POST_NOTIFICATIONS`；旧包没有后者，Android 13+ 的通知页就会把开关画成灰的、点不动。用 `app/.nsh/out/Navigator.apk` 覆盖安装（`adb install -r`，保留数据），再打开 App 看「连到 Mac → 通知」。如果版本已经是 0.1.6 但开关仍灰，检查这台手机上领航是不是被停用、被工作资料/家长控制限制，或装在另一个用户下；用下面的命令能看到实际装的是哪个包、有没有声明权限：

```sh
adb shell dumpsys package com.lele.navigator | grep -E 'versionName|versionCode|POST_NOTIFICATIONS'
adb shell cmd appops get com.lele.navigator POST_NOTIFICATION
```

如果权限只是被拒（不是灰），可以直接补授，不用重装：

```sh
adb shell pm grant com.lele.navigator android.permission.POST_NOTIFICATIONS
```

**仍然没有“App 关闭时到点提醒”。** 新 API 只有 `show`，没有 `schedule(at:)` 或 `AlarmManager` 一类的后台唤醒；手机在 App 没运行时不会在截止时刻自己醒来。提前提醒和通知上的「完成 / 推迟 1 小时」两枚按钮也仍只在 Mac 上。

**开发/测试进程没有通知中心。** `nsh test` 的 runner 是没有 bundle 的裸可执行文件，`currentNotificationCenter` 会抛 Objective-C 异常直接 abort 进程。所以调用前先看 `NSBundle.mainBundle().bundleIdentifier()`，再用 `objc2::exception::catch` 兜一层——无头跑测试不会因此崩，端口和测试都不受影响。

---

## OTA 更新

App 的 TSX 可以作为签名包（`.nshpkg`）从 GitHub Release 下发，不用每次重新装 APK。**装一次 `0.1.6 (build 7)` 的 APK 之后**，只改界面、逻辑、图片和字体都可以走 OTA；改 Rust crate、nsh runtime、权限或 manifest 仍然要出新 APK。

- `app/nsh.json` 的 `updater` 指向 `dongjiahong/navigator` 的最新 Release，并写了两个公钥：`publicKey` 验 `latest.json`，`packages.roots` 验 `.nshpkg`。
- 签名私钥在仓库外：`~/.navigator-ota/`（`root.secret` 离线保存；`release.secret`、`release.cert`、`update.secret` 用于发版）。**不要把任何 `.secret` 提交进仓库。**
- 没有 CI：发版全在本机。跑 `scripts/ota-release.sh --build 7 --notes CHANGES.md`，把 `dist/*.nshpkg`、`dist/latest.json`、`dist/latest.json.sig` 三个文件连同 APK 一起传到 GitHub Release（顺序：包先，manifest 和签名后）。
- 每次发版都要把 `app/nsh.json` 的 `build` 加一；`version` 也一起改。App 只在包比当前 build 新时才装。
- App 启动后 5 秒检查一次；手机在「连到 Mac」Sheet 里还有「检查更新」。Android/iOS 下载后**下次冷启动**运行，桌面可以按「重启」立刻运行。包第一次运行有 10 秒试用期，起不来会自动回退。

---

## 同步机制

同步的目标很具体：**同一个 Wi-Fi 下，手机不用填任何地址、只输一次 6 位配对码就能连上；两台 Mac 输入同一个码就接在同一张看板上，彼此直连同步；Mac 重启换了 IP 也能自己找回；Mac 关掉软件，同步就停。**

没有账号、没有云端、没有常驻服务。整个机制由四部分组成。

### 1. 服务住在每台 Mac 软件的进程里

Mac 端的 Rust crate（`app/src/lib.rs`）在 App 启动时 `TcpListener::bind(("0.0.0.0", 8787))`，用一个后台线程接收连接，每个连接一个线程。

- 服务**只**在 App 运行时存在。退出 App，端口关闭，别的设备的同步请求失败，而不是对着一个陈旧副本说话。
- 没有 launchd daemon，没有用户要手动跑的脚本。
- `Sync.start` 是幂等的：已经 bind 过就直接返回那个端口，不会在同一个进程里泄漏第二个监听器。
- **每台 Mac 既是服务端也是客户端。** 它一边监听，一边探测网络上的其它 Mac 并互相同步；手机只当客户端（它的改动跟着请求走，应答带回 Mac 的），但对**发现的每一台 Mac** 都同步。所以两台 Mac 都开着时三台设备收敛，只开一台时手机和它收敛，另一台 Mac 下次开机补上。
- 手机不监听：一次交换本来就是双向的，手机主动连每台 Mac 就够；在 Android 上常驻监听要面对后台被杀、Doze 和电量，而且没有任何一次交换离得开它。

### 2. 每台设备靠广播发现对方（借 LocalSend 的思路）

IP 会因 DHCP 租约变化，所以**不把 IP 存起来当配置**。[LocalSend](https://github.com/localsend/localsend) 的做法是设备加入同一个 UDP 组播组，靠收到的报文源地址认人。我们只需要它的一半：

```
设备 A（Mac / 手机）                     设备 B（Mac）
 |                                       |
 |  UDP → 192.168.5.255:8788             |
 |  "NAVIGATOR/1 DISCOVER"  ------------->|
 |                                       |
 |  <-----  UDP 单播回 "NAVIGATOR/1 OFFER 8787"
 |                                       |
 |  从报文源地址得知 B = 192.168.5.99     |
 |  TCP → 192.168.5.99:8787/state        |
```

关键三点：

- **地址是从应答报文的源地址读出来的**（`recv_from` 的 `from.ip()`），不是应答内容里写的。所以 Mac 换了 IP，下一次探测自然落在新地址上。
- **每个网卡各发一条定向广播**。`255.255.255.255` 会走默认路由——手机插着移动数据时那条路由属于运营商，广播出不了 Wi-Fi。所以 `broadcast_addresses()` 用 `getifaddrs` 读出每个网卡的地址和掩码，算出各自的广播地址（如 `192.168.5.255`）再发。这是 LocalSend 之外我们补的一步。
- **一次探测收集所有应答，而不是第一个。** 两台 Mac 在同一个局域网里都会回答；只认跑得快的那台，等于只和一半设备共享同一张看板。设备用自己的端口和地址认出「这是我自己发的」，不再连自己。

探测超时 0.7 秒。探测失败之后不是死等 3 秒重试，而是退避：3 / 6 / 12 / 24 / 30 秒（`probe_backoff`）。因为「对方可能正开机」值得 3 秒一次，而「在家里坐了一下午」不该是每 3 秒一次广播的电台。三件事会把退避立刻归零：App 回到前台（`Sync.nudge()`）、手填地址、找到了设备。已经有对端时也会每 15 秒顺手探一次，好碰到后开的 Mac。

手填地址仍然保留，作为「网络禁广播」时的退路（手机是 `连到 Mac` 面板，Mac 是 `配对码` 面板）；它只是**多一个对端**，不会关掉探测，所以不会因为手填了一台而看不见另一台。

### 3. 进来看板要一对六位数字

局域网里不止一台设备：咖啡馆的 Wi-Fi 里，8787 端口对所有人都是开着的。所以每张看板有一个 6 位数字，显示在标题栏的「配对码」里，每台设备拿它证明自己读过这台屏。实现在 `app/src/auth.rs`（服务端）与 `app/pairing.ts`（两端共用的那点文字与状态）。

- **一个看板一个码。** 这个码属于看板，不属于生成它的那台机器。第二台 Mac 在「配对码」面板里输入第一台的 6 位数字，从此自己也用这个码做应答和证明，两台就直接互相同步；手机输的是同一个码。重新生成只改当前设备，所以其它设备都要重新输入一遍，弹窗里先说明这件事。
- **码不上线。** 设备先 `GET /challenge` 拿一个 16 字节随机 nonce（30 秒有效、用一次即删、表里最多 64 个），再用 `HMAC-SHA256(key=码, msg=nonce)` 算出证明，放在 `X-Nav-Proof` 里，连同 `X-Nav-Nonce` 发给 `/state`。线上没有码本身，只有对一个一次性挑战的签名。
- **比对是常量时间的**（`auth::same`），不会从「第几个字节开始不对」漏出信息。
- **错 5 次锁 60 秒**（`FAIL_MAX` / `LOCK`）：100 万种码按这个速度猜要四个月。被锁时回 `429` 并带上剩余秒数，对端把这整段等完——回前台也不提前打断别人的锁。锁是每台设备自己的门，不影响它和别的设备的交换。
- **码存在设备自己的存储里**（`Storage` 键 `navigator.pairCode`，不进 SQLite：一个设置不该和用户的卡片挤在同一张表里）。配过一次就不再输。
- `/health` 与 `/challenge` 不需要码，也不读卡片。

### 4. 合并按字段，不按整张卡

两边都持有整份看板，合并是逐卡、逐字段的：

- **每个字段一个戳。** `stamps` 里 title / notes / tags / due / repeat / status / deleted / rank 这 8 个字段各有一个时间戳（TS 的 `MERGE_FIELDS` 与 Rust 的 `board::MERGE_FIELDS` 是同一张表），合并时每个字段取戳新的那一份：Mac 上打的标题和同一分钟手机按的「完成」都活下来。`updatedAt` 于是是各字段戳里的最大值，而不只是「最后动手的时间」——按行问「变了吗」「给我 since 之后的行」仍然成立。没有 `stamps` 的旧数据，每个字段退回这张卡自己的 `updatedAt`。
- **平局也有确定答案。** 两个钟撞在同一毫秒时，取 JSON 文本较大的值（UTF-16 码元序）。两端跑同一条规则，所以谁先问都一样。
- **删除是一个字段。** 删卡不是丢行，而是 `deleted: true` 加一个新戳；撤销删除就是再写一次 `deleted: false`，戳更新，所以凭空赢。删标签同理，另外每张带过这个标签的卡都会被盖一次戳，把「取下标签」也同步过去。直接丢 id 的话，另一台设备下一次合并会把它推回来。
- **顺序也是数据。** 列内位置是卡上的 `rank`：插入取前后两名的中点，间隔小于 `1e-6` 就整列按 1000 步长重编号；新卡落列末。SQLite 里的 `ord` 列只是旧数据的兜底缓存，装载一律按 `rank` 排——不然手机和 Mac 会各显示各的顺序。旧看板首次启动迁移一次：按当前显示顺序写 1000、2000…，字段戳用最低值 0，一次批量写入，且就地改对象（换副本会让每个 cell 重建，正拖着的卡会掉手）。
- **问的是「你比我新多少」，而且要得比实际新一点。** 每侧发 `{cards, tags, since}`：自己改过的行，加上**从这一台**听过的最新戳；对方只回戳在 `since` 之后的行。`since` 还往前退 5 分钟（`MARGIN`），因为两台设备的钟不一样：对方慢两分钟时，它新卡上的戳可能是这边已经读过去的时刻，严格的水平线会让那张卡永远不到。
- **每个对端各有自己的水位和补发队列。** `PEER` 不再是一个全局地址，而是 `PEERS` 里的若干条：每台设备记住每个对端的 `heard`（它告诉过我们的最新戳）、它的拒绝/锁定状态，以及没送达的行。一台 Mac 关着或码不对，只影响它自己那一条，其它对端照常同步；它回来时从自己的水位补上。合并是逐字段、留墓碑的，所以同一行重复过网是安全的。
- **两端一份用例。** TS 的 `mergeCard` 与 Rust 的 `board::merge_cards` 共用 `app/merge-cases.json` 里的同一组向量，两边行为不一致会当场挂掉。
- **只有卡片是逐字段的。** 标签仍整条按戳合并：一个标签就是名字和色相，没有两台设备各改一半的场合。

### 为什么手机不走 `fetch`

Android 从 targetSdk 28 起默认禁止**明文 HTTP 到非本机地址**，而我们的流量只走局域网。nsh 在打包时给 manifest 写了 `usesCleartextTraffic="true"`，但实测手机端 `fetch` 到 `192.168.1.x` 仍被系统拦下（手机 shell 里 `nc` 到同一端口却是 `200 OK`）。

与其在打包产物上打补丁，手机端改用**自己的 TCP 连接拼 HTTP 请求**（`post_state`）。请求就四行，四行手写比在别人的打包流程里塞一个网络安全配置更可靠。

### 线程模型

网络全部发生在 Rust 的线程里，UI 线程一次网络都不碰：

| 位置 | 线程 | 职责 |
|---|---|---|
| Mac | 监听线程 + 每连接一线程 | 应答 `/health` `/challenge`，以及要过码的 `/state` |
| Mac | 发现线程 | 应答 UDP 探测 |
| 每台设备 | `exchange_loop` | 探测所有对端、`GET /challenge`、带证明 POST、把结果写进 inbox；每个对端各有水位和补发队列 |
| 手机 | 无监听 | 只跑 `exchange_loop`，和发现的每一台 Mac 各交换一次 |

JS 侧每 700ms（Mac 每 2.5 秒）做一次极轻的轮询（读两个 `Mutex` 单元，不是网络）：有新内容才 `Sync.offer(...)`，有回包才 `Sync.inbox()`。所以对端睡着时界面完全不会卡。Mac 每 2.5 秒把自己的改动先写进文件、再把对端写进去的行读回来（它读的是同一个文件，不是另一份看板）。`exchange_loop` 自己每 3 秒问一次「你那边有什么新的」（没有改动就发空 body），否则在一台设备上加的卡要等到下次被编辑才会到另一台。

`sameBoard()` 按 `id + updatedAt + deleted` 逐卡比较，**绝不比较 JSON 文本**——服务端会用排序后的键重新序列化，字符串比较会每个 tick 都报「变了」，`cards.set` 就会在手指底下重绘看板。

### 接口

Mac 端服务（手机也走这几个）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | `{"ok":true}`：只说「这儿有一台 Mac」，不报卡片数——这个端点对网络上所有人开放 |
| `GET` | `/challenge` | `{"nonce":"…"}`：16 字节、30 秒、用一次即删 |
| `GET` | `/state?since=…` | 要 `X-Nav-Nonce` + `X-Nav-Proof`；回 `{"cards":[...],"tags":[...],"at":…}`，或 `401`（码不对/挑战失效）、`429`（锁了，带剩余秒数） |
| `POST` | `/state` | 同上要证明；请求体 `{cards, tags, since}`（早期只发裸卡片数组的客户端仍能同步，tags 当空处理），合并后回同样的差分 |

发现用 UDP：`8788` 上收 `NAVIGATOR/1 DISCOVER`，回 `NAVIGATOR/1 OFFER <端口>`。

### 已知边界

- 同一局域网才能连，不穿透 NAT，不走公网。
- **要配对码，但仍是明文 HTTP。** 码本身不上线，可线上的卡片内容是明文的：同一个 Wi-Fi 里被动抓包的人读得到你在写什么。要的是「同网段的人不能随手改我的板」，不是「内容保密」。
- **锁是把双刃剑。** 5 次失败锁 60 秒挡住了穷举，也意味着同一网段有人故意发 5 次错码就能把你的手机挡在门外一分钟。这是「没有账号、不做用户系统」的代价。
- 同一张卡上的并发编辑现在按字段各取其一，两种改动都留得下；标签仍是整条合并，两台设备同时改一个标签的名字和颜色，其中一次会整条输掉。
- 两台设备**各自**给旧看板做一次顺序迁移时，若它们看到的列顺序不同，会有一版列的 `rank` 不一致；合并取较大值后两端一致，用户的下一次移动把剩下的定下来。
- 整列重编号会给卡写一个新的 `rank` 戳，于是自动归档的计龄（按 `updatedAt` 算）被重置——重编号过的卡重新从今天开始计。没有 `doneAt` 字段，这是它的近似。
- 改状态（而不是拖拽）总是落在目标列的末尾：移动按 `rank` 中点插入，按状态按钮移动没有「想插在第几行」这个信息。

## 数据

每台设备把自己的看板存在自己的数据目录里：`<dataDir>/board.sqlite3`，通过 crate 的 `Board` 打开。关掉 App 不会丢东西，手机那块板在没有 Mac 的时候也是真的。

- **一行就是一张卡。** `id`、`updated_at`、`status`、`deleted`、`ord`，加上 `body`——卡片本体的 JSON（标题、备注、标签、截止、重复、`stamps`、`rank`）。`body` 是权威，`ord` 只是旧数据的兜底缓存：列内顺序看 `rank`。
- **写的是变了的行。** 一次改动记下来，300ms 后落盘（`SAVE_MS`）；App 退到后台或退出时，把还在等的那点改动立刻 flush 掉，所以最后一个字不会丢。判断「变了」= 行的戳 / 墓碑 / `rank` 与上次写进去的不同（`changes.ts`），不比 JSON 文本。
- **每天一份整板备份。** 那天第一次打开时，把整份文档（**含墓碑**和标签）拷到 `<dataDir>/backups/navigator-YYYY-MM-DD.json`，同一天不重复，只留最近 7 份（`backup::KEEP`）。文件名形状本身就是访问控制：只认 `navigator-YYYY-MM-DD.json`，所以一个目录里别的东西进不了恢复流程。
- **导出**写 `~/Downloads/领航-YYYYMMDD-HHmm.json`（或 `.md`），内容是活着的卡片，按列排好，不含墓碑——导出是给人读或给人的文件，不是快照。nsh 没有文件对话框，`openUrl` 也不接受 `file:`，所以路径是算出来的；第一次往下载文件夹写时 macOS 可能弹一次授权。
- **导入**从剪贴板读 JSON，按戳合并（本机更新的同 id 卡片不会被覆盖），写之前确认并点名「新卡 N 张、更新 M 张」。
- **恢复**是把备份里缺失、被删、被改的行写回去，给每个字段打上恢复时刻的新戳（所以能压过删掉它的墓碑）；备份之后新建或改过的卡不会被删，备份里的墓碑跳过。
- **手机不导出。** 导出的入口在 Mac 的命令面板里（`Cmd+K`），恢复同理。

## 图标

源设计是根目录的 `navigator.svg`（深石板蓝圆角底、灰蓝八角星、暖金双环与 42° 指针）。**两端都是同一个圆角方体**，只是画布占比不同：

- `app/icon.svg` → `app/icon.png`（1024，圆角方体占 824/1024，四周透明）。`nsh.json` 的 `icon` 指向它，`nsh package --target macos` 用 `sips` 转成 `AppIcon.icns`。**macOS 不会帮你切圆角**：App 图标的形状必须画在图里，四周留透明（Dock 自己的背景透出来，和邻居一样），所以是 80% 的方体 + 10% 边距，正好落在 Apple 的网格上。
- `app/icon-android.svg` → `app/icon-android.png`（同样的圆角，但方体占 960/1024，边距只留 3%）。launcher 自己会画外框，图形占满一点才不会被缩成一小块：

```bash
nsh package --target android --icon icon-android.png
```

nsh 只认一个 `icon` 键（写对象会报 `invalid type: map`），所以 Android 走命令行参数。

验证方式：`NSWorkspace.shared.icon(forFile:)` 渲染出来是圆角 + 透明边距（不是系统套的白底方块），APK 里 `res/mipmap-xxxhdpi/ic_launcher.png` 也是圆角。曾经试过满幅直角的版本，macOS 会把它当成一整块，Dock 里就没有圆角了——所以别改回满幅。

## 验证过的

- 无头：`nsh test` → 278 通过 + 2 条按设计跳过（`src/pairing_test.rs` 里会写盘的两条 `#[ignore]`，要单独跑）。共 280 条：TSX 界面测试 223 + Rust 单测 57（55 通过 + 2 条跳过）。
- macOS 全量：`nsh test --target macos` → **分文件验证，没有跑过合并后的全量**，所以这里不填数字。
- Android 真机（Redmi 25060RK16C / Android 16，Wi-Fi 调试）：`nsh test --target android` → 28 个测试文件、187 个用例，186 通过；唯一失败的一条属于手机行的侧滑，那块正在改，数字之后单独补。Android 目标只跑 TSX 测试，crate 的 Rust 单测在无头那一轮里跑，两个数字不能相加。
- 真机同步与配对（手机与 Mac 同网段 `192.168.6.x`，Mac 端用隔离的 `HOME` 运行）：未配对时状态行是「需要配对码」；输对码即「已同步」且两端计数一致；错码显示「配对码不对」且不会反复重试；连错 5 次显示「尝试太多次，稍后再试」，锁定期内没有请求发出；Mac 重新生成配对码后手机回到「配对码不对」；重启手机后不再要求输码。
- 逐字段合并与墓碑同样在真机上走过：Mac 改标题、手机同时点完成，合并后两端都是新标题且已完成；`rank` 重排从 Mac 传到手机；Mac 库里删掉的卡是保留 `title` / `status` / `rank` 的墓碑，不是丢行。
- 自动发现：重装 APK、清空存储后启动，未输任何地址即找到 Mac（UDP 广播 + 源地址回读）。那次验证还没有配对码，所以它证明的是「发现」这一段；配对码之后的完整流程见上一条。
- 多设备（两台 Mac + 一台手机）：实现是「每台 Mac 既服务又探测、Mac 之间直连互同步；手机只当客户端、但对发现的每一台 Mac 都同步」，水位、拒绝和补发都是按对端记的。Rust 侧用回环 socket 把 `exchange_loop` 打到真实的 `handle` 上跑过完整一轮（`the_exchange_thread_syncs_with_a_typed_peer`：typed 地址 → 鉴权 → 合并 → inbox → `status` 里的 peer）；**两台真实 Mac 同时在局域网里的收敛没有跑过**，本机只有一台 Mac，这一段只由单元测试与单机回环覆盖。配对码「一个看板一个码」（第二台 Mac 输入第一台的码）由 `Pairing.test.tsx` 覆盖。
- 手机上手实测：捕获 Sheet（含「连续添加」、撤销提示不遮「添加」按钮）、详情页逐键编辑、备注里 URL 一行点开真的拉起浏览器、到期横幅在前台出现、示例数据清除入口，都在真机上走过一遍；行中部横滑翻页无误触，长按行操作 Sheet、列顶下拉刷新都不崩。卡片的左右滑动手势已移除：横向拖动只翻页，完成 / 归档 / 删除 / 打开都在长按 Sheet 与详情页里；`RowActions.test.tsx` 覆盖长按 Sheet 的 完成 / 归档 / 恢复 / 删除 与「横向拖动不操作卡片」，真机待复测。
- Android 通知（API 35 模拟器 `navigator_api35`）：把截止设到今天 20:00 后，`dumpsys notification` 里出现 `tag=navigator.card.c3`、标题「到时间了：写周报」；点通知打开手机的卡片详情页；进程被 `kill -9` 后从通知冷启动，仍然打开同一张卡。真机尚未复测。
- 手机竖向滚动 1224 帧掉帧 0.82%（p50 10ms / p90 12ms / p95 13ms / p99 14ms，Missed Vsync 0）。
- 打包：`scripts/build-android.sh`（arm64 + fat LTO + `opt-level=z`）出来的 APK 26.0 MB（debug 签名）。同一份源码用默认 profile 打双 ABI 是 78.1 MB，只出 arm64 仍是 46.2 MB——差的是 LTO 把每个泛型实例只在链接时保留一份（`.text` 30.6 MB → 12.9 MB）；换成 `opt-level=s` 是 30.9 MB。`panic=abort` 还能到 22.7 MB，但会拆掉 nsh 用 `catch_unwind` 做的错误边界，不用。
- 无头稳定性：一天里跑 8 次无头 `nsh test`，1 次在引擎退出阶段 SIGSEGV（栈 `js_free_value_rt` ← `reactive::free_all` ← `state::uninstall`），其余 7 次正常。只发生在退出阶段，不是 App 逻辑，没有尝试改引擎。
- **中途 SIGSEGV 先怀疑引擎和缓存，不是业务代码。** `Panel.test.tsx` 在输入长备注时偶尔崩在 `JS_CallInternal` ← `js_array_find` ← `dom::item_run`；同一份代码逐文件二分时表现成「加一行无关 import 就崩、删掉就好」，HEAD 版本也会偶发。清掉 `.nsh/test/build` 后全量 282 条一次通过；之后在 APK 打包占满 CPU 时又复现过一次，紧接着单独重跑又通过。所以这类崩溃：先清缓存、避开并行重负载再重跑，不要为它改业务逻辑。
- 对比度在真机像素上实测：FAB 字形 7.40:1，记一笔空态按钮 6.96:1。
- 图标：`NSWorkspace` 渲染出来是圆角方体 + 透明边距（10% 每边），APK 里 `res/mipmap-xxxhdpi/ic_launcher.png` 也是圆角。
- 日历在真机上点过一遍：选 11 月 24 日，卡片的截止从「今天 20:00」变成「11月24日 20:00」，时间没被改掉。

## 开发

```bash
cd app

nsh dev                 # 在 host 里跑，热重载
nsh test                # 跑全部测试（Rust 单测 + TSX 界面测试）
nsh check               # 类型检查 + cargo check
nsh test --target android   # 在真机上跑测试
```

打包：

```bash
# 仓库根目录
scripts/build-android.sh          # → app/.nsh/out/Navigator.apk（arm64，26 MB）

# app/ 里
nsh package --target macos        # → .nsh/out/Navigator.app
```

Android 不要直接用 `nsh package --target android` 发：它默认同时打 arm64 和 armeabi-v7a、用没有 LTO 的默认 release profile，出来是 78.1 MB。脚本只做这两件事，原因和实测数字写在脚本开头。

截图（需要真实绘制，无头模式拿不到）：

```bash
nsh test --target macos Shot     # 桌面截图
nsh test --target macos Dark     # 深色截图
```

### 测试的三个注意点

- **测试默认关掉同步。** `testkit.ts` 通过 `open` 的初始存储在每次开 App 时写 `navigator.syncEnabled = "0"`。不这样，测试里的看板会和开发者正开着的那份 Mac App 真合并——待办数在用例之间自己涨，断言随之漂移。这个开关对用户也是有效的：`"0"` 就让这台设备单干，标题栏显示「未同步」。
- **截图类测试在没有绘制能力或没有可指定窗口的平台会提前返回。** 手机不接受窗口尺寸（App 铺满屏幕），无头引擎不绘制。这样无头那一轮「通过 + 1 条按设计跳过」都是真通过，没有靠报红冒充覆盖；macOS 与真机的数字见上面「验证过的」。
- **`dragAndHold` 只在无头和 Linux 可用**，真实 macOS / Android 宿主跑不了，`DragHold.test.tsx` 因此按「能否绘制」取反判断——它仍然在无头执行里真跑，且是真断言。

### 环境要求

- **Rust 1.99.1**，钉在 `app/rust-toolchain.toml`。`nsh-core 0.4.0` 用了 `isolate_lowest_one`、const `f32::round` 和 if-let guards，1.89 稳定版编译不过。
- **Android NDK** `27.2.12479018`（因为项目带 Rust crate），以及 1.99.1 的 `aarch64-linux-android` / `armv7-linux-androideabi` / `x86_64-linux-android` target。

## 目录

```
app/
  App.tsx           入口：选 Mac 还是手机布局、头条、快捷键、启动顺序
  MacBoard.tsx      四列看板 + 整卡拖拽 + 边缘自动滚动
  Inspector.tsx     浮在窗口正中的卡片面板（备注占满剩余高度）
  PhoneHome.tsx     手机端：分段控件、分页、记一笔、详情、长按行、筛选 Sheet
  FilterBar.tsx     Mac 的筛选条：日期组、标签条（放不下的进「更多」）、标签管理、清除、搜索
  strip.ts          筛选条要多少宽度才装得下（纯函数，先算再画）
  palette.tsx       命令面板（Cmd+K）：新建、跳转、筛选、清空、提前提醒、导出导入、配对码、检查更新
  PairDialog.tsx    配对码面板（Mac）：6 位数字与「重新生成」
  BackupTool.tsx    从备份恢复的列表
  data.ts           卡片、标签的模型与操作（墓碑、戳、rank、撤销提示、自动归档）
  fields.ts         逐字段合并：哪些字段、每个字段的戳、平局怎么判
  merge.ts          合并与比较（纯函数，可单测）
  merge-cases.json  两端共用的合并用例（TS 与 Rust 各跑一遍）
  changes.ts        「哪些行变了」：戳 / 墓碑 / rank，不比 JSON 文本
  persist.ts        落盘：读回看板、300ms 防抖写入、顺序迁移
  repeat.ts         重复的算术：下一次截止、后继卡的 id、「有没有人动过它」（纯函数，可单测）
  recurrence.ts     完成带重复的卡就在待办末尾生成下一次（启动一次 + 看板变化后的 effect，幂等）
  sync.ts           同步宿主/客户端：状态、轮询、配对码的存取
  pairing.ts        配对码的两端共用部分：只收数字、`482 913` 的写法、状态那句话
  reminders.ts      截止提醒：Mac 排系统通知（含提前提醒与两个动作），手机在 App 打开时发系统通知，没有权限时用 App 内横幅
  updates.ts        OTA：检查签名包、下载、手机下次冷启动 / 桌面重启后生效
  deadline.ts       截止与提前提醒的本机设置
  filters.ts        搜索、多标签、日期筛选（Mac 和手机共用同一份代码；筛选是本机状态，不跨设备同步）
  focus.ts          键盘光标：上下左右、换列、按行号继承
  backup.ts         导出 JSON / Markdown、导入与恢复的计划（纯函数，可单测）
  backupStore.ts    每天一份备份的读写，以及下载文件夹里的导出文件
  badge.ts          Dock 角标：逾期 + 今天到期且未完成
  panel.ts          面板尺寸与备注高度（纯数字，可单测）
  geom.ts           布局常量、看板几何（拖拽读的那份原点/尺寸）
  theme.ts          两套配色、五种标签色相、字号、阴影、`onAccentWash()` / `onAccentFill()`
  checklist.ts      清单就是备注里的 `- [ ] ` 行：解析、勾选、追加、卡片上的预览
  text.ts           文字要占几行、备注里有哪些链接
  chrome.ts         头条两段：`titleSpacer()` + 38pt 自己的控制行
  ui.tsx            图标、标签、截止编辑器、日历、标签管理器、撤销提示、确认框
  testkit.ts        测试用的开 App 辅助（默认关掉同步）
  Repeat.test.tsx   重复：日期推进、后继卡的 id、撤销时「还没人动过它」
  Checklist.test.tsx  清单：解析、勾选、追加、卡片 meta 行上的进度
  icon.svg          图标源（Mac：圆角方体占 80%，透明边距）
  icon-android.svg  图标源（Android：同样的圆角，占 94%）
  src/lib.rs        同步服务（HTTP + UDP 发现）+ 系统通知 + Dock 角标
  src/board.rs      SQLite：行、墓碑、逐字段合并、`since` 之后的差分行
  src/auth.rs       配对码：随机码、挑战、HMAC 证明、常量时间比较、失败锁定
  src/backup.rs     每天一份备份的写与轮转、导出的文件写入
  src/pairing_test.rs  整条握手的回环测试（写盘的那条 `#[ignore]`，单独跑）
```

设计依据见 `DESIGN.md`，产品约束见 `PRODUCT.md`。
