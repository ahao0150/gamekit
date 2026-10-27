# 网络：`request` 与 `openSocket`

> 核对日期：2026-10-27（取消能力落地后二次校准）。签名与行为按工作区里的
> `packages/runtime/src/core/net/**` 与 `packages/runtime/src/platform/*/net.ts` 逐条核对
> （不是按草案猜的）；文末 §9 列了仍待确认的点。
> 签名速查在 [`ENGINE-API.md`](ENGINE-API.md) 的 `core/net` 一节；这份文档只写**怎么用、怎么判错**。

## 1. 这一层解决什么

三端网络 API 是三套东西：

| | web | 微信小游戏 | 抖音小游戏 |
|---|---|---|---|
| HTTP | `fetch` | `wx.request` | `tt.request` |
| WebSocket | `WebSocket` | `wx.connectSocket` | `tt.connectSocket` |
| 失败形态 | Promise reject | 回调里的 `errMsg` | 回调里的 `errMsg` |

分成两层：

- **平台层**（`platform/*/net.ts`，契约 `platform/net-contract.ts`）：只负责「把请求发出去、
  把 socket 事件搬回来」。传输失败**直接 throw**；超时与取消都 throw 一个
  `name === 'AbortError'` 的 Error（两者同名，core 靠 `signal.aborted` 区分，业务看不到这层）。
  不解析、不重试、不做状态机。
- **core 层**（`core/net/`）：补默认值、序列化 body、判定 HTTP 成败、JSON 解析、重试退避、
  socket 状态机 / 队列 / 心跳 / 重连，并且把平台抛的错归一成 `kind`。

业务只写 `request(net, ...)` / `openSocket(net, ...)`，不出现 `fetch` / `wx.` / `tt.`。
**两个函数都不抛错**：成功失败都是返回值，调完只需要 `if (res.ok)` / 读 `error.kind`。

`net` 是平台适配器上的**可选**成员（`PlatformAdapter.net?: NetService`）。`request` /
`openSocket` 的第一个参数允许传 `null` —— 平台没有网络能力时，`request` 返回一条
`kind: 'network'` 的失败响应，`openSocket` 返回一个已经 `closed` 的 socket，**不会抛错**。

## 2. 30 秒上手

**GET 一次**（游戏里统一用包名 `@mg/runtime`，不写引擎内部路径）：

```ts
import { request } from '@mg/runtime';
import type { PlatformAdapter } from '@mg/runtime/platform';

const loadDaily = async (platform: PlatformAdapter): Promise<{ day: number; reward: number } | null> => {
  const res = await request<{ day: number; reward: number }>(platform.net ?? null, {
    url: 'https://api.example.com/daily',
    timeoutMs: 5000,
  });
  if (!res.ok || res.data === null) {
    console.warn('[net] 拉取日常失败', res.error?.kind, res.status, res.error?.message);
    return null;
  }
  return res.data;
};
```

**连一条 socket**：

```ts
import { openSocket } from '@mg/runtime';
import type { PlatformAdapter } from '@mg/runtime/platform';

const connectRoom = (platform: PlatformAdapter, roomId: string) => {
  const socket = openSocket(platform.net ?? null, {
    url: `wss://api.example.com/room/${roomId}`,
    timeoutMs: 6000,
  });

  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'hello', roomId }));
  });
  socket.on('message', (data) => {
    const text = typeof data === 'string' ? data : '';
    if (text === '') return; // 二进制帧本轮不处理
    let msg: { type: string; payload?: unknown };
    try {
      msg = JSON.parse(text) as { type: string; payload?: unknown };
    } catch {
      console.warn('[net] 收到了非 JSON 帧，丢弃', text.slice(0, 80));
      return;
    }
    if (msg.type === 'tick') console.log('[net] tick', msg.payload);
  });
  socket.on('close', (info) => console.warn('[net] 断开', info.code, info.reason));

  return socket; // 离开房间时必须 socket.close()
};
```

## 3. `request()` 完整用法

```ts
request<T = unknown>(net: NetService | null, options: RequestOptions, retry?: RetryPolicy)
  => Promise<NetResponse<T>>
```

### 3.1 参数

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | `string` | 必填 | 小游戏必须是 https 且域名在白名单；相对路径只有 web 有效 |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE' \| 'PATCH'` | `'GET'` | 小游戏**不支持 `PATCH`**（微信 / 抖音的 method 合法值里没有它），传下去会失败并归一成 `kind:'network'`；契约保留它只为三端签名统一（见 §6）。真要 `PATCH` 语义得服务端配合 override（如 `POST` + `X-HTTP-Method-Override`），**这一层不代劳** |
| `headers` | `Readonly<Record<string, string>>` | `{}` | 值必须是字符串。**响应头**键一律转小写（三端一致，取值不用试大小写）；**请求头**原样透传，建议也写小写 |
| `body` | `unknown` | 无 | 字符串 / `ArrayBuffer` 原样发；**对象与数组自动 `JSON.stringify` 并补 `Content-Type: application/json`**（已有则不改） |
| `timeoutMs` | `number` | `8000` | 毫秒。**传 `0` = 不设超时**（平台与 core 都不计时，弱网会永挂） |
| `responseType` | `'json' \| 'text' \| 'arraybuffer'` | `'json'` | 见 3.3 的回落规则 |
| `signal` | `CancelSignal` | 无 | 取消信号，传 `createCancel().signal`。已取消 → **一个请求都不发**，直接返回 `kind:'abort'`；请求中取消 → 立刻返回且**不重试**（见 3.4） |

`retry`（第三个参数）是 `RetryPolicy`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `attempts` | `number` | `1` | **总尝试次数（含第一次）**。`1` = 不重试；`< 1` 按 `1` |
| `baseDelayMs` | `number` | `300` | 第 n 次失败后等 `min(base × 2^(n-1), max)` |
| `maxDelayMs` | `number` | `2000` | 退避上限 |

只重试 `error.retryable === true` 的失败（`timeout` / `network` / `http 5xx`）。

```ts
import { request } from '@mg/runtime';
import type { NetService } from '@mg/runtime/platform';

const saveSlot = async (net: NetService | null, slot: number, coins: number): Promise<boolean> => {
  const res = await request(net, {
    url: 'https://api.example.com/save',
    method: 'POST',
    body: { slot, coins },          // 对象：自动 JSON + 补 Content-Type
    timeoutMs: 6000,
  }, { attempts: 3 });              // 最多 3 次，只对可重试错误生效
  return res.ok;
};
```

### 3.2 返回值

```ts
interface NetResponse<T = unknown> {
  readonly ok: boolean;                                 // = status 是 2xx 且没有 error
  readonly status: number;                              // 没拿到响应（超时 / 断网 / 无 net）时为 0
  readonly headers: Readonly<Record<string, string>>;   // 键统一小写
  readonly data: T | null;                              // 见 3.3
  readonly error?: NetError;                            // ok=false 时一定有
}

interface NetError {
  readonly kind: 'timeout' | 'network' | 'http' | 'parse' | 'abort';
  readonly message: string;                             // 中文原因，可直接进日志
  readonly retryable: boolean;                          // 是否值得自动重试
}
```

四条容易踩的语义：

- **非 2xx 也会解析响应体并放进 `data`**（`ok` 仍为 `false`）。4xx 常见的 `{ code, message }`
  直接读得到，别只按 `status` 猜原因。
- **2xx + 空响应体（204 / 空字符串）算成功**：`ok:true`、`data:null`，不报 `parse` 错。
- `status === 0` 表示**没有拿到 HTTP 响应**（超时 / 断网 / 无 `net` / 被取消）；此时 `headers` 是 `{}`。
- 被取消时（`kind:'abort'`）也是 `status: 0`、`data: null`，靠 `error.kind` 和超时区分。

### 3.3 `responseType` 与 `data`

| `responseType` | 2xx + 合法 JSON | 2xx + 不是 JSON | 2xx + 空响应体 | 非 2xx（4xx / 5xx） |
|---|---|---|---|---|
| `'json'`（默认） | 解析后的对象 / 数组 / 原始值 | `data` = **原文 `string`**，`ok=false`，`error.kind='parse'` | **成功**：`data=null`、`ok=true` | `data` = 解析后的 body（空体则 `null`），`error.kind='http'` |
| `'text'` | `data` = 原文 `string` | 同左 | **成功**：`data=null`、`ok=true` | `data` = 原文 body（空体则 `null`） |
| `'arraybuffer'` | `data` = `ArrayBuffer` | 同左（不解析） | `data=null`、`ok=true` | `data` = body（若有），`error.kind='http'` |

> 边缘情况：若平台在 `'json'` / `'text'` 下仍返回了 `ArrayBuffer`，core 会把二进制**原样**放进
> `data` 并 `ok=true`（不强行当文本解析）。

要点：默认 `'json'` **不会**因为服务端返回 HTML 错误页而抛错 —— 解析失败时原文仍然拿得到
（`typeof data === 'string'`），但 `ok=false`。日志里要留下原文，下面这个函数可以直接抄：

```ts
import type { NetResponse } from '@mg/runtime';

/** 失败时把「服务端到底回了什么」打进日志；成功时不打。 */
const logFailureBody = (res: NetResponse): void => {
  if (res.ok) return;
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data) ?? '';
  console.warn('[net] 失败响应', res.status, res.error?.kind, body.slice(0, 200));
};
```

### 3.4 取消（`signal`）

**为什么要有**：「切场景时取消在飞的请求」是游戏里的真实需求 —— 玩家点返回、请求还在飞，
回调打到已销毁的场景上就是幽灵 bug。AI 写代码不会主动想到取消，所以入口由框架摆好。

小游戏**没有** `AbortController` / `AbortSignal`（见 §7-4），所以用框架自带的 `createCancel()`：

```ts
import { createCancel, request } from '@mg/runtime';
import type { NetService } from '@mg/runtime/platform';

const loadProfile = (net: NetService | null, onHp: (hp: number) => void): (() => void) => {
  const cancel = createCancel();
  void request<{ hp: number }>(net, {
    url: 'https://api.example.com/player',
    signal: cancel.signal,
  }).then((res) => {
    if (res.error?.kind === 'abort') return;   // 自己取消的：静默，不报错
    if (res.ok && res.data !== null) onHp(res.data.hp);
  });

  return () => cancel.abort();   // 离开场景时调一次
};
```

硬语义：

- 传进**已取消**的信号 → 一个请求都不发，直接返回 `kind:'abort'`。
- 请求中取消 → 立刻返回 `kind:'abort'`、`retryable:false`，**哪怕 `retry` 写了 3 次也不会重试**。
- 取消拿到的是 `kind:'abort'`，**不是** `timeout` —— 别按超时处理，也不要弹「网络不稳定」。
- `abort()` 幂等；一个 `CancelSource` 只能取消一次，下一批请求要重新 `createCancel()`。
- **socket 不收 `signal`**：要停就连 `socket.close()`（见 §5）。

## 4. 错误决策表（这一节最重要）

`error.kind` **5 个值都会出现**；HTTP 非 2xx 统一是 `kind: 'http'`，用 `status` 区分 4xx / 5xx。

| `error.kind` | 典型 `status` | 含义 | 该做什么 | `retryable` |
|---|---|---|---|---|
| `timeout` | 0 | `timeoutMs` 内没拿到完整响应 | 提示稍后重试 / 交给重试策略；不要无限转圈 | `true` |
| `network` | 0 | 断网、DNS / TLS 失败、域名不在白名单、web 端 CORS 被拒、微信不支持的方法 | 提示检查网络；白名单 / CORS / PATCH 是**配置或能力错**，重试也没用（见 §7-2） | `true`（`net` 缺失时是 `false`） |
| `http` | `400–499` | 请求本身有问题（参数、鉴权、权限、路径） | **别重试**；先看 `data` 里的业务码 / 错误信息（多数 API 会带 `{ code, message }`），据此提示用户或修参数；`401` 走刷新 token | `false` |
| `http` | `500–599` | 服务端或网关出错 | 可重试（退避）/ 降级到缓存；`data` 里通常也有服务端错误信息，可记日志 | `true` |
| `parse` | 2xx | 响应不是 JSON（网关 HTML、字段类型不对） | 当文本处理或按格式错上报；**别把它当成功** | `false` |
| `abort` | 0 | 主动取消（切场景 / 新请求顶掉旧的），或宿主中断 | **忽略即可**，不用报错、不弹提示 | `false` |

`net === null`（平台没有网络能力）也会落到 `kind: 'network'`，但 `retryable: false`、
`message` 是「当前平台没有网络能力（platform.net 缺失）」——这种情况重试无意义。

> **取消后拿到的是 `kind:'abort'`，不是 `timeout`**：两者在平台层是同一种「中断」，
> 只有 `signal.aborted` 能区分。`timeout` 的 `retryable` 是 `true`，误判会让一次主动取消
> 触发重试、把请求又发一遍；`abort` 的 `retryable` 恒为 `false`，也不会进入重试循环。

分支写法（`res` 是上一次 `request` 的结果；`showRetryToast` / `refreshToken` 等是游戏自己的函数）：

```ts
const res = await request(net, { url, timeoutMs: 6000 });

if (res.ok) {
  useData(res.data);
} else if (res.error !== undefined) {
  switch (res.error.kind) {
    case 'timeout':
    case 'network':
      showRetryToast('网络不稳定，点此重试');
      break;
    case 'http': {
      const body = res.data as { code?: string; message?: string } | null; // 非 2xx 的 body 在这里
      if (res.status === 401) await refreshToken();
      else if (res.status >= 500) {
        logServerError(body?.code, body?.message); // 服务端给的原因别丢
        scheduleRetry(3);
      } else {
        showError(body?.message ?? `请求有误（${res.status}）`); // 4xx：改参数，别重试
      }
      break;
    }
    case 'parse':
      reportFormatError(res.status, String(res.data).slice(0, 200));
      break;
    case 'abort':
      break; // 切场景 / 主动取消：静默
  }
}
```

`retryable` 只用于**自动重试开关**；给用户的提示仍按 `kind` / `status` 分，别把「401」显示成「网络错误」。

## 5. `openSocket()` 完整用法

```ts
openSocket(net: NetService | null, options: SocketOptions) => Socket
```

**同步返回**，连接在后台进行：拿到的对象立刻可以 `on()` / `send()`，不用 `await`。

### 5.1 参数

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | `string` | 必填 | 小游戏必须 `wss://` 且域名在白名单 |
| `protocols` | `readonly string[]` | 无 | 子协议；三端透传给宿主 |
| `timeoutMs` | `number` | `8000` | **握手**超时（发起连接 → `'open'`）；`<= 0` 不设超时 |
| `reconnect` | `{ maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number }` | `maxAttempts: 0`（不重连） | 第 n 次重连等 `min(base × 2^(n-1), max)`；`baseDelayMs` 默认 `500`、`maxDelayMs` 默认 `8000` |
| `heartbeat` | `{ data: string; intervalMs: number }` | 不传 = 不发 | **两个字段都必填**：`'open'` 期间每 `intervalMs` 发一次 `data` |

> socket **不收 `signal`**：`close()` 就是取消入口（`close()` 后永不重连，要恢复只能新建）。

### 5.2 状态机

```text
                    openSocket()
                         │
                         ▼
                      idle（瞬时，外部基本看不到）
                         │
                         ▼
                    connecting ──(timeoutMs 内没连上 / connect 失败)
                         │                 │
                    ('open')               │ emit error + close(0, …)
                         ▼                 ▼
                       open ──(对端关闭 / 网络断)──► closed
                         │                        │
                    close()（主动）                └─(maxAttempts>0)──► connecting（重连第 n 次）
                         ▼
                     closing（瞬时） ─────────────────────────────────► closed
```

- `state` 共 5 个值：`'idle' | 'connecting' | 'open' | 'closing' | 'closed'`；
  `openSocket()` 内部立刻发起连接，所以外部通常第一次读就是 `'connecting'`。
- 重连不新增状态，就是**回到 `'connecting'`**；用 `reconnectCount` 知道重连了几次。
- `close()` 是**主动关闭**：置 `manualClose`，之后**永不重连**（要恢复只能新建一个 socket）。

### 5.3 返回对象

| 成员 | 类型 | 说明 |
|---|---|---|
| `state` | `'idle' \| 'connecting' \| 'open' \| 'closing' \| 'closed'` | 当前状态（只读） |
| `url` | `string` | 连接地址（只读） |
| `send(data)` | `(data: string \| ArrayBuffer) => boolean` | `true` = **立刻发出**；`false` = **没发出去**（入队或丢弃，见 5.4） |
| `on(event, cb)` | `(event, cb) => () => void` | 订阅；返回**退订函数**；回调抛错会被吞掉，不影响状态机 |
| `close(code?, reason?)` | `(code?: number, reason?: string) => void` | 主动关闭；默认 `1000`；幂等 |
| `sentCount` | `number` | 已交给宿主的帧数（含心跳；不等于服务端收到） |
| `recvCount` | `number` | 已收到的消息帧数 |
| `reconnectCount` | `number` | 已发起的重连次数 |
| `droppedCount` | `number` | 队列满时被丢弃的**最旧**帧数 |

事件回调参数（`SocketEventMap`）：

| 事件 | 回调参数 | 说明 |
|---|---|---|
| `'open'` | `undefined` | 握手成功，可以 `send` |
| `'message'` | `string \| ArrayBuffer` | 文本帧是 `string`；二进制是 `ArrayBuffer`（不做 JSON 解析） |
| `'close'` | `{ code: number; reason: string; wasClean: boolean }` | `wasClean`：主动 `close()` 或对端 `1000` 为 `true`；异常断开 `code=1006` 之类 |
| `'error'` | `{ message: string }` | 握手失败 / 握手超时 / 传输层报错；之后通常还会收到 `'close'` |

### 5.4 `send` 的入队语义

1. `state === 'open'`：立即交给宿主，返回 `true`，`sentCount++`。
2. **其它状态（`connecting` / `closing` / `closed`）**：消息**入队**，返回 `false`。`'open'` 后会按 FIFO flush。
   **`false` 不代表失败**，只代表「这次没有立刻发出去」。
3. **队列上限 100 条**（`SOCKET_QUEUE_LIMIT`）：满了再入队会**丢掉最旧的一条**，`droppedCount++`。
   丢旧不丢新 —— 旧消息通常已有更新的状态覆盖它。
4. `close()` **不会清空队列**，也不增加 `droppedCount`；已关闭的 socket 再 `send` 仍会入队、永远发不出去。
   业务应在 `close()` 后停止 `send`。
5. 重连**不会重放已经发出去的帧**（那是业务层的 ack / 重发语义）。重连期间新 `send` 的帧会入队，成功后 flush。

```ts
// 片段：socket 是 openSocket() 的返回值
const queued = socket.send(JSON.stringify({ type: 'move', x: 12, y: 30 }));
if (!queued && socket.droppedCount > 0) {
  console.warn('[net] 有帧被丢弃，已丢', socket.droppedCount, '条（不是这次这条）');
}
```

### 5.5 心跳与重连

**心跳**（默认关）：传 `heartbeat: { data: 'ping', intervalMs: 30000 }` 后，`'open'` 期间每
`intervalMs` 直接发一次 `data`（走传输层，不走队列；`sentCount++`）。它解决 NAT / 代理把空闲
连接静默掐断；**不负责业务 ack**，服务端回 `pong` 就在 `'message'` 里自己处理。

**重连默认关**（`maxAttempts: 0`），原因有两条，都是真实故障模式：

1. 自动重连会**掩盖服务器故障**：服务端挂了，客户端一直显示「重连中」，用户和日志都看不到错。
2. 重连会与业务自己的重试 / 幂等策略打架：重连成功不代表消息没丢，业务仍要做 ack 与重发。

开启后的语义：断线（非主动 `close`）→ `reconnectCount++`、`state='connecting'`，等
`min(500 × 2^(n-1), 8000)` 毫秒后重连；每次失败都会再发一次 `'close'`（所以重连期间可能收到
多条 `'close'`）。次数用完仍失败 → `'closed'`，不再重试。

### 5.6 一条完整的生命周期

```ts
import { openSocket } from '@mg/runtime';
import type { PlatformAdapter } from '@mg/runtime/platform';

const joinRoom = (platform: PlatformAdapter, roomId: string, onEvent: (text: string) => void) => {
  const socket = openSocket(platform.net ?? null, {
    url: `wss://api.example.com/room/${roomId}`,
    timeoutMs: 6000,
    reconnect: { maxAttempts: 3 },          // 只在明确接受「可能掩盖故障」时开
    heartbeat: { data: 'ping', intervalMs: 30000 },
  });

  const offMessage = socket.on('message', (data) => {
    if (typeof data === 'string') onEvent(data);
  });
  socket.on('error', (err) => console.warn('[net] socket 错误', err.message));
  socket.on('close', (info) => console.warn('[net] socket 关闭', info.code, info.reason, info.wasClean));

  // 握手还没完成也能发：返回 false（入队），'open' 后按序发出
  socket.send(JSON.stringify({ type: 'join', roomId }));

  return () => {
    offMessage();
    socket.close(1000, 'leave room');
  };
};
```

## 6. 三端行为差异

`core/net` 已经把超时、重试、队列、心跳、错误归一化做在公共层；下表只列**收不进公共层**的差异。
业务代码**不需要**按平台写分支，知道差异只是为了排查问题。

| 能力 | web | 微信小游戏 | 抖音小游戏 |
|---|---|---|---|
| 请求实现 | `fetch` + `AbortController` | `wx.request`（强制 `dataType:'text'`，解析权归 core） | `tt.request`（同微信） |
| 域名白名单 | 无（受 CORS 限制） | 必须在小程序后台配置 request 合法域名，且 https | 同（在抖音后台配置） |
| 证书 | 浏览器校验 | 必须 https / wss | 同 |
| Cookie | 同源自动携带 | 没有 Cookie 概念 | 没有 Cookie 概念 |
| `PATCH` | 可用 | **不支持**，会归一成 `kind:'network'` | **不支持**，同微信 |
| 超时 / 取消 | core 计时 + `AbortController.abort()` 真正中止 | 平台自己计时 + `task.abort()`（基础库默认值不一，有 60s 的） | 同微信 |
| 响应头键 | 一律转小写 | 一律转小写 | 一律转小写 |
| 自定义响应头 | **读不到**，除非服务端回 `Access-Control-Expose-Headers` | 无限制 | 无限制 |
| `body` | 字符串 / `ArrayBuffer`（core 已序列化） | 同（`wx.request` 的 `data`） | 同 |
| WebSocket | 原生 `WebSocket`（`binaryType='arraybuffer'`） | `wx.connectSocket` | `tt.connectSocket` |
| socket 并发 | 受浏览器同源连接数限制 | **同一时间最多 5 条**，开第 6 条失败 | 同量级（按 5 条设计） |
| 二进制帧 | `ArrayBuffer` | `ArrayBuffer` | `ArrayBuffer` |

> 「微信 5 条」来自 `wx.connectSocket` 官方文档；宿主改版会变，但**按「一条连接多路复用」设计**
> 就与上限无关 —— 不要为聊天、房间、战斗各开一条 socket。

## 7. 坑

**1. 小游戏没有 `fetch`，产物里出现 `fetch(` 就崩**
- 症状：web 正常，真机白屏或 `fetch is not a function`。
- 原因：业务代码直接 `fetch(...)`，或把 web 专用库打进小游戏包；小游戏也没有 `new URL`。
- 写法：只用 `request(platform.net ?? null, ...)`；构建后在全量产物里搜 `fetch(`（web 实现里允许，
  `build/wx` / `build/tt` 的 js 命中即回退）。平台差异只准出现在 `packages/runtime/src/platform/**`。

**2. 把域名白名单 / CORS / 微信不支持的 `PATCH` 当成「网络抖动」重试**
- 症状：每次都失败但提示「网络不稳定」，重试 3 次全挂，日志里只有 `network`。
- 原因：`network` 同时覆盖「真断网」和「配置 / 能力错」（域名没加白名单、http 而非 https、
  CORS 被拒、微信端传 `PATCH`）。
- 写法：`network` 先看 `message`；**首次就全失败**时按配置错排查：小游戏后台域名白名单 / 证书 /
  方法合法值；web 看 Network 面板的 CORS 报错。配置错不要自动重试。

**3. `send` 返回 `false` 就以为发送失败**
- 症状：连接刚建立时发的消息被「重试」，导致服务端收到重复操作。
- 原因：`send` 返回 `false` 只表示「当前不是 `open`，已入队」，不是失败；`'open'` 后会按序发出。
- 写法：只在**确实要确认送达**时等业务 ack；`false` 时看 `droppedCount` 是否增长判断有没有被丢弃。

**4. 小游戏里用 `AbortController` / `AbortSignal` 直接崩**
- 症状：web 一切正常，微信 / 抖音真机报 `AbortController is not defined`（`ReferenceError`）。
- 原因：小游戏环境没有浏览器那两个全局对象；取消只能走宿主的 `task.abort()`。
- 写法：只用框架的 `createCancel()` + `RequestOptions.signal`（见 §3.4）。业务代码里不该出现
  `AbortController` —— 桥接在 `platform/*/net.ts` 里做完了。

**5. 非 2xx 时写 `if (!res.ok) return;`，把服务端的错误信息丢了**
- 症状：用户只看到「请求失败」，日志里没有服务端给的 `{ code, message }`，排查全靠猜。
- 原因：4xx / 5xx 的响应体**已经解析进 `data`**，但很多写法在 `ok === false` 时直接 return。
- 写法：失败分支先读 `data`：`const body = res.data as { code?: string; message?: string } | null;`，
  把 `body?.code` / `body?.message` 写日志或直接提示，再按 `status` 决定是否重试。

**6. 超时传 `0` 导致请求永挂**
- 症状：弱网下 Promise 一直不 resolve，界面永久 loading。
- 原因：`timeoutMs: 0` 表示**不设超时**（平台与 core 都不计时），不是「用默认值」。
- 写法：省略 `timeoutMs`（默认 8000）或显式传正数；业务 UI 也应有自己的「重试」按钮。

**7. 以为重连会补发消息，或者会一直重连**
- 症状一：断线重连后服务端状态与客户端不一致（少了最后几条操作）——重连只重建连接，
  **不会重放已经发出去的帧**；关键操作要带序号 / ack，`'open'` 里重新同步一次状态。
- 症状二：调用 `close()` 之后还在等重连——`close()` 会置 `manualClose`，**永不重连**；要恢复请新建 socket。
- 另：重连期间每次失败都会再发一次 `'close'`，别把「多条 close」当成多次业务断线。

**8. 平台没有 `net` 时，订阅不到 `error` / `close`**
- 症状：低端宿主 / 测试环境里 socket 立刻是 `closed`，但 `on('error')` 一次都没触发。
- 原因：`openSocket(null, ...)` 在**返回之前**就同步发完了 `'error'` 与 `'close'`，此时还没订阅。
- 写法：拿不到 `platform.net` 时先判 `socket.state === 'closed'`，或用 `platform.can('net')` 提前分支。

**9. web 上读不到自定义响应头（`x-total-count` / `x-trace-id` 之类），不是你的代码错**
- 症状：同一个接口，`res.headers['content-type']` 有值，但自定义头全是 `undefined`；换成小游戏端同样的代码却能读到。
- 原因：**浏览器的 CORS 安全模型**——跨域响应只把「safelisted」响应头暴露给 JS
  （`cache-control` / `content-language` / `content-length` / `content-type` / `expires` /
  `last-modified` / `pragma`），其余的头即使传输层收到了也对 JS 不可见。
- 写法：让服务端在响应里加 `Access-Control-Expose-Headers: x-total-count, x-trace-id`
  （列全需要的头，或写 `*`），前端代码一行都不用改。**别去改 `lowercaseHeaders` —— 那不是 bug 现场。**

## 8. 测试怎么写

原则：**不连真网**。`platform` 自带一个可编程的假传输层 `createMockNet()`（`platform/mock/net.ts`），
`request` / `openSocket` 的第一个参数就是注入点。它还能反过来断言「core 到底发了什么」
（`net.requests` / `net.sockets[0].sent`）。

**测 `request`：parse 回落 / 超时 / 空体 / 取消**

```ts
import { describe, expect, it } from 'vitest';
import { createCancel, request } from '@mg/runtime';
import { createMockNet } from '@mg/runtime/mock';

describe('request', () => {
  it('200 但不是 JSON → data 是原文 text，error.kind=parse，不抛错', async () => {
    const net = createMockNet({ response: { status: 200, headers: {}, body: '<html>bad gateway</html>' } });
    const res = await request(net, { url: 'https://api.example.com/ping' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(200);
    expect(res.error?.kind).toBe('parse');
    expect(res.error?.retryable).toBe(false);
    expect(res.data).toBe('<html>bad gateway</html>');
    // 假 net 记录了 core 归一化后的请求参数
    expect(net.requests[0]?.method).toBe('GET');
  });

  it('平台慢于 timeoutMs → kind=timeout、status=0，不抛错', async () => {
    const net = createMockNet({ delayMs: 60 });
    const res = await request(net, { url: 'https://api.example.com/slow', timeoutMs: 10 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('timeout');
    expect(res.data).toBeNull();
  });

  it('204 空响应体 + 默认 json → 成功、data=null（不是 parse 错）', async () => {
    const net = createMockNet({ response: { status: 204, headers: {}, body: '' } });
    const res = await request(net, { url: 'https://api.example.com/ack' });
    expect(res.ok).toBe(true);          // 空体算成功
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
    expect(res.error).toBeUndefined();
  });

  it('400 + JSON 错误体 → ok=false，但 data 里读得到服务端的 code/message', async () => {
    const net = createMockNet({
      response: { status: 400, headers: {}, body: '{"code":"E_AUTH","message":"token expired"}' },
    });
    const res = await request(net, { url: 'https://api.example.com/save', method: 'POST' });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe('http');
    expect(res.error?.retryable).toBe(false);   // 4xx 不重试
    expect(res.data).toEqual({ code: 'E_AUTH', message: 'token expired' });
  });

  it('传已取消的信号 → 一个请求都没发出去，kind=abort 且不重试', async () => {
    const net = createMockNet({ delayMs: 20 });
    const cancel = createCancel();
    cancel.abort();
    const res = await request(
      net,
      { url: 'https://api.example.com/player', signal: cancel.signal },
      { attempts: 3 },                          // 写了 3 次也不该重试
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error?.kind).toBe('abort');      // 不是 timeout
    expect(res.error?.retryable).toBe(false);
    expect(net.requests).toHaveLength(0);       // 真的一个都没发
  });
});
```

**测 `openSocket`：入队、flush、队列溢出丢最旧**

```ts
import { expect, it } from 'vitest';
import { openSocket } from '@mg/runtime';
import { createMockNet } from '@mg/runtime/mock';

it('握手前 send 入队（返回 false），open 后按序 flush', async () => {
  const net = createMockNet({ autoOpen: false }); // 连接由测试手动打开
  const socket = openSocket(net, { url: 'wss://api.example.com/room' });

  expect(socket.send('m1')).toBe(false); // 未 open：入队，不是失败
  const raw = net.sockets[0];
  expect(raw).toBeDefined();
  if (raw === undefined) return;
  await Promise.resolve();               // 让 core 先挂上 onOpen 订阅（connect 的 then 是微任务）
  expect(raw.sent).toEqual([]);          // 还没真的发
  raw.open();
  expect(raw.sent).toEqual(['m1']);      // open 后 flush
  expect(socket.state).toBe('open');
});

it('未 open 时超过 100 条：丢最旧 + droppedCount++；close 后 send 仍返回 false', async () => {
  const net = createMockNet({ autoOpen: false });
  const socket = openSocket(net, { url: 'wss://api.example.com/room' });

  for (let i = 1; i <= 101; i += 1) expect(socket.send(`m${i}`)).toBe(false);
  expect(socket.droppedCount).toBe(1);   // 第 101 条挤掉了 m1

  const raw = net.sockets[0];
  expect(raw).toBeDefined();
  if (raw === undefined) return;
  await Promise.resolve();               // 同上：先让 core 订阅
  raw.open();
  expect(raw.sent).toHaveLength(100);
  expect(raw.sent[0]).toBe('m2');        // 最旧的被丢，不是最新的
  expect(raw.sent[99]).toBe('m101');

  socket.close(1000, 'done');
  expect(socket.send('after-close')).toBe(false); // 关闭后仍入队，但永远发不出去
  expect(socket.state).toBe('closed');
});
```

## 9. 已知限制与待确认

1. **`send` 在 `closed` 后仍会入队**（返回 `false`、永不发送、队列满会挤掉旧帧）。业务必须在
   `close()` 后停止 `send`。
2. `heartbeat` 的两个字段（`data` / `intervalMs`）都必填、无默认值；`intervalMs <= 0` 等于不发。
3. `NetService` 的原始接口：`request(opts, signal?) => Promise<RawNetResponse>` 与
   `connect(url, protocols?) => Promise<SocketTransport>`（`platform/net-contract.ts`）。
   平台层用 throw 表达失败，**超时与取消都是 `name='AbortError'`**，core 据 `signal.aborted`
   区分成 `timeout` / `abort` —— 这是平台实现者要守的约定，写游戏时不用管。
4. 小游戏端**不支持 `PATCH`**（会归一成 `kind:'network'`）：微信 / 抖音的 method 合法值里没有它，
   三端通用方法以 `GET` / `POST` / `PUT` / `DELETE` 为准；需要局部更新语义时由服务端 override
   （`POST` + `X-HTTP-Method-Override`），本层不代劳。
5. 取消**不适用于 socket**：`openSocket` 没有 `signal`，要停就连 `close()`。
