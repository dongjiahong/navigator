# 领航 · Navigator

一个 Mac + Android 的原生看板：四列（待办 / 进行中 / 已完成 / 归档），卡片有标题、标签、备注和截止时间。Mac 和手机都能编辑，两边实时同步。

技术栈是 [Native Shell (nsh)](https://nsh.dev)：界面用 TSX，同步服务用 Rust，编译成各自平台的原生视图，没有 WebView。

窗口不保留系统标题栏：`Window.setTitleBar({ style: "hidden" })` 让 App 顶到窗口上沿，交通灯落在 App 自己那条 54pt 的头条上，看板文字按 `titleBar().left` 让开，整条可拖动移动窗口。留下一条原生 App 没画的系统栏，看起来就像浏览器里的网页。

## 界面上的几条硬规矩

- **看板不横向滚动。** 四列随窗口变宽，到 `COL_MAX` 就不再长，多出来的空间把整排居中。窗口有下限（`MIN_WINDOW` = 1106，四列到 `COL_MIN` 的宽度）；nsh 没有设最小尺寸的 API，所以用一个 `effect` 在窗口掉到下限以下时把它拉回来。
- **卡片是浮起来的，不是挤出来的。** 点开一张卡，它浮在窗口正中（440px，`shadowLift`），四列宽度一点不动；早先它是挤在右边的一列，一打开卡看板就重排，手指刚点的那个位置就换了东西。
- **没有滚动条。** 所有 `Scroll` / `List` 都写 `scrollbar={false}`：一页纸边上出现一条系统画的长条，是 App 没画的界面。
- **标签是用户的数据。** 标签有名字和五种色相（蓝色相由深到浅都在调色板里定义了两遍），在标签管理器里改名、换色、删除；删除会从所有卡片上取下，并且和卡片一样按 `updatedAt` 同步、留墓碑。
- **截止有具体时间，也有日历。** 今天 / 明天 / 下周 只改日期，时间留着不动；`TimeField` 改时分；日历面板选任意一天（`Calendar` 自己画出星期几和月份，因为 nsh 的 `Calendar` 不画任何字，而且它的弹层在这个引擎里是透明的）。卡片上永远显示到分钟。
- **删除要先确认。** 用平台原生 `AlertDialog`，对话框里点名是哪张卡；墓碑不是 App 能替用户撤销的东西。
- **截止会提醒。** Mac 上是一条真正的系统通知（Rust 侧直接走 `UNUserNotificationCenter`，带系统通知音，App 退出后照样送达）；手机上系统通知发不出去（见下），所以在 App 打开时用横幅提醒。

---

## 提醒（截止时间的通知）

nsh 0.4.0 没有任何通知 API，所以这块能力写在 Rust crate 里（`app/src/lib.rs` 的 `Reminder`）。

**Mac：走系统通知中心。** `UNUserNotificationCenter` 按卡片 id 建请求，触发时间是「距现在多少秒」，内容带标题、备注摘要和 `UNNotificationSound::defaultSound()`——声音是用户在「系统设置 → 通知 → 领航」里选的那个，不是 App 自己塞的文件。调度权交给系统之后，App 退出、关机重启都不影响送达。被系统拒绝时（没授权）走 `status()` 回报 `denied`，界面不会假装通知过。

- 只有「还没做完 + 有截止 + 截止在未来」的卡才排期；完成、归档、删除即时撤销。
- 同一张卡改了截止或标题会以同名 id 覆盖，不会堆两条。
- 已经过期的截止不排期：过期的卡在板上已经显示红色的「已逾期」，再推一条通知是噪音。
- 测试用 `Reminder.pending()` 读回系统真正持有的请求，断言的是系统状态而不是 App 自己的记账。

**Android：发不了系统通知。** Android 13+ 需要 manifest 里有 `POST_NOTIFICATIONS`，而 `nsh package` 写的 manifest 只有 `INTERNET`，也没有任何配置项能加（`nsh.json` 的键是白名单）。所以 `Reminder.status()` 在 Android 上直接是 `unsupported`，手机改用在 App 打开时检查「五分钟内刚到期」的卡，在列表上方出一条横幅，可以「打开」或「知道了」。

**开发/测试进程没有通知中心。** `nsh test` 的 runner 是没有 bundle 的裸可执行文件，`currentNotificationCenter` 会抛 Objective-C 异常直接 abort 进程。所以调用前先看 `NSBundle.mainBundle().bundleIdentifier()`，再用 `objc2::exception::catch` 兜一层——无头跑测试不会因此崩，端口和测试都不受影响。

---

## 同步机制

同步的目标很具体：**同一个 Wi-Fi 下，手机不用填任何地址就能连上 Mac；Mac 重启换了 IP 也能自己找回；Mac 关掉软件，同步就停。**

没有账号、没有云端、没有常驻服务。整个机制由三部分组成。

### 1. 服务住在 Mac 软件的进程里

Mac 端的 Rust crate（`app/src/lib.rs`）在 App 启动时 `TcpListener::bind(("0.0.0.0", 8787))`，用一个后台线程接收连接，每个连接一个线程。

- 服务**只**在 App 运行时存在。退出 App，端口关闭，手机的同步请求失败，而不是对着一个陈旧副本说话。
- 没有 launchd daemon，没有用户要手动跑的脚本。
- `Sync.start` 是幂等的：已经 bind 过就直接返回那个端口，不会在同一个进程里泄漏第二个监听器。

### 2. 手机靠广播发现 Mac（借 LocalSend 的思路）

IP 会因 DHCP 租约变化，所以**不把 IP 存起来当配置**。[LocalSend](https://github.com/localsend/localsend) 的做法是设备加入同一个 UDP 组播组，靠收到的报文源地址认人。我们只需要它的一半：

```
手机                                    Mac
 |                                       |
 |  UDP → 192.168.5.255:8788             |
 |  "NAVIGATOR/1 DISCOVER"  ------------->|
 |                                       |
 |  <-----  UDP 单播回 "NAVIGATOR/1 OFFER 8787"
 |                                       |
 |  从报文源地址得知 Mac = 192.168.5.99   |
 |  TCP → 192.168.5.99:8787/state        |
```

关键两点：

- **地址是从应答报文的源地址读出来的**（`recv_from` 的 `from.ip()`），不是应答内容里写的。所以 Mac 换了 IP，下一次探测自然落在新地址上。
- **每个网卡各发一条定向广播**。`255.255.255.255` 会走默认路由——手机插着移动数据时那条路由属于运营商，广播出不了 Wi-Fi。所以 `broadcast_addresses()` 用 `getifaddrs` 读出每个网卡的地址和掩码，算出各自的广播地址（如 `192.168.5.255`）再发。这是 LocalSend 之外我们补的一步。

手机侧探测超时 1.2 秒，失败就隔 3 秒重试。连上之后如果交换失败（Mac 睡了、换网了），**立刻丢掉已知地址重新探测**，所以网络变化会在几秒内自愈。

手填地址仍然保留，作为「网络禁广播」时的退路（`连到 Mac` 那个面板）。

### 3. 合并不是覆盖

两边都持有整份看板，按卡片合并，标签同样：

- **每张卡、每个标签按 `updatedAt` 后写胜出（last-write-wins）。** 手机在隧道里离线一小时，回来也覆盖不掉 Mac 之后做的编辑。
- **删除写成墓碑。** 删卡不是丢行，而是留一条 `{...card, deleted: true, updatedAt: now()}`；删标签同理，另外每张带过这个标签的卡都会被盖一次时间戳，把「取下标签」也同步过去。直接丢 id 的话，另一台设备下一次合并会把它推回来。墓碑带更新的时间戳，所以合并时天然赢，删掉的东西不会复活。
- **服务端也不无条件改写 revision。** 一次没有带来新内容的轮询不会让看板看起来「被改过」。
- **请求体是 `{cards, tags}`。** 早期只发卡片数组的客户端仍然能同步（tags 当空处理）。

合并逻辑在两边各有一份实现（TS 的 `mergeBoards` / `mergeTags`、Rust 的 `merge`），行为一致，各有测试。

### 为什么手机不走 `fetch`

Android 从 targetSdk 28 起默认禁止**明文 HTTP 到非本机地址**，而我们的流量只走局域网。nsh 在打包时给 manifest 写了 `usesCleartextTraffic="true"`，但实测手机端 `fetch` 到 `192.168.1.x` 仍被系统拦下（手机 shell 里 `nc` 到同一端口却是 `200 OK`）。

与其在打包产物上打补丁，手机端改用**自己的 TCP 连接拼 HTTP 请求**（`post_state`）。请求就四行，四行手写比在别人的打包流程里塞一个网络安全配置更可靠。

### 线程模型

网络全部发生在 Rust 的线程里，UI 线程一次网络都不碰：

| 位置 | 线程 | 职责 |
|---|---|---|
| Mac | 监听线程 + 每连接一线程 | 应答 `/health` `/state` |
| Mac | 发现线程 | 应答 UDP 探测 |
| 手机 | `exchange_loop` | 探测、POST、把结果写进 inbox |

手机侧 JS 每 700ms 做一次极轻的轮询（读两个 `Mutex` 单元，不是网络）：有新内容才 `Sync.offer(...)`，有回包才 `Sync.inbox()`。所以 Mac 睡着时手机界面完全不会卡。

`sameBoard()` 按 `id + updatedAt + deleted` 逐卡比较，**绝不比较 JSON 文本**——服务端会用排序后的键重新序列化，字符串比较会每个 tick 都报「变了」，`cards.set` 就会在手指底下重绘看板。

### 接口

Mac 端服务（手机也走这几个）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | `{"cards":15,"tags":5,"ok":true,"revision":3}` |
| `GET` | `/state` | `{"cards":[...],"tags":[...],"revision":3}` |
| `POST` | `/state` | 请求体是 `{cards, tags}`（也接受裸卡片数组）；合并后返回合并结果 |

发现用 UDP：`8788` 上收 `NAVIGATOR/1 DISCOVER`，回 `NAVIGATOR/1 OFFER <端口>`。

### 已知边界

- 同一局域网才能连，不穿透 NAT，不走公网。
- 没有鉴权。局域网内任何人都能读写这个端口——这是「无账号、只在 LAN 内」这个选择的代价，不是疏忽。
- 卡片级最后写入胜出：如果两台设备在同一秒改同一张卡的不同字段，一方的改动会被整张覆盖。字段级合并（CRDT）没有做。
- 数据不落盘（见下）。

## 数据

目前是**内存数据**：从 `app/data.ts` 里的示例卡片与示例标签开始，进程退出就回到初始状态。持久化还没接。

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

- 无头：`nsh test` → 51/51（含 Rust 单测 8 项）。
- macOS：`nsh test --target macos` → 43/43。
- Android 真机（Redmi 25060RK16C / Android 16）：`nsh test --target android` → 43/43。
- 同步在真机上验过四个场景：手机新建 → Mac 收到；Mac 改卡 → 手机同步；手机删除 → Mac 留下完整墓碑；旧副本尝试复活 → 仍是删除态。
- 自动发现：重装 APK、清空存储后启动，未输任何地址即连上 Mac（UDP 广播 + 源地址回读）。
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
nsh package --target macos      # → .nsh/out/Navigator.app
nsh package --target android    # → .nsh/out/Navigator.apk
```

截图（需要真实绘制，无头模式拿不到）：

```bash
nsh test --target macos Shot     # 桌面截图
nsh test --target macos Dark     # 深色截图
```

### 测试的三个注意点

- **测试默认关掉同步。** `testkit.ts` 通过 `open` 的初始存储在每次开 App 时写 `navigator.syncEnabled = "0"`。不这样，测试里的看板会和开发者正开着的那份 Mac App 真合并——待办数在用例之间自己涨，断言随之漂移。这个开关对用户也是有效的：`"0"` 就让这台设备单干，标题栏显示「未同步」。
- **截图类测试在没有绘制能力或没有可指定窗口的平台会提前返回。** 手机不接受窗口尺寸（App 铺满屏幕），无头引擎不绘制。这样无头 51/51、macOS 43/43、Android 43/43 都是真通过，没有靠报红冒充覆盖。
- **`dragAndHold` 只在无头和 Linux 可用**，真实 macOS / Android 宿主跑不了，`DragHold.test.tsx` 因此按「能否绘制」取反判断——它仍然在无头执行里真跑，且是真断言。

### 环境要求

- **Rust 1.99.1**，钉在 `app/rust-toolchain.toml`。`nsh-core 0.4.0` 用了 `isolate_lowest_one`、const `f32::round` 和 if-let guards，1.89 稳定版编译不过。
- **Android NDK** `27.2.12479018`（因为项目带 Rust crate），以及 1.99.1 的 `aarch64-linux-android` / `armv7-linux-androideabi` / `x86_64-linux-android` target。

## 目录

```
app/
  App.tsx           入口，选 Mac 还是手机布局
  MacBoard.tsx      四列看板 + 拖拽
  Inspector.tsx     浮在窗口正中的卡片面板
  PhoneHome.tsx     手机端：分段控件、分页、记一笔、详情
  data.ts           卡片、标签的模型与操作（含墓碑）
  merge.ts          合并与比较（纯函数，可单测）
  sync.ts           同步宿主/客户端，状态与轮询
  theme.ts          两套配色、五种标签色相、字号、间距
  geom.ts           布局常量
  filters.ts        搜索与标签筛选（Mac 和手机共用）
  reminders.ts      截止提醒：Mac 排系统通知，手机用 App 内横幅
  ui.tsx            图标、标签、截止编辑器、日历、标签管理器、删除确认
  icon.svg          图标源（Mac：圆角方体占 80%，透明边距）
  icon-android.svg  图标源（Android：同样的圆角，占 94%）
  src/lib.rs        同步服务（HTTP + UDP 发现 + 合并）+ 系统通知
```

设计依据见 `DESIGN.md`，产品约束见 `PRODUCT.md`。
