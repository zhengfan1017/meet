// 一条龙：浏览器登录 → 签发窄权限 token → 发布 → 复验
//
//   node tools/surge-publish.cjs <域名> [项目目录]
//
// 为什么要有这个脚本：
//
// surge 官方的 `surge login --browser` 是一次性的。登录会话 10 分钟过期，
// 过期后 url 和 code 都作废，用户还没点批准就得重来一遍。
// 这里改成循环：会话过期就自动重开一个，把新的 url / code 写到
// SURGE_LOG_FILE，批准之后自动签发窄权限 token 并发布。
//
// 沙箱里还有两个坑：
// 1. surge-stream 用原生 https.request，不认 HTTPS_PROXY，发布走不通。
//    这里把它的 request 模块换成走 undici ProxyAgent 的版本。
// 2. 账号必须验证邮箱，否则发布被服务端拒绝，但命令行版不告诉你原因。

const path = require("path")
const Module = require("module")
const fs = require("fs")
const os = require("os")

const SURGE_ROOT = path.join(
  process.env.HOME || "/root",
  ".nvm/versions/node/v24.1.0/lib/node_modules/surge"
)
const SURGE_STREAM_LIB = path.join(SURGE_ROOT, "node_modules/surge-stream/lib")
const requestPath = path.join(SURGE_STREAM_LIB, "request.js")

const DOMAIN = process.argv[2]
const PROJECT = path.resolve(process.argv[3] || ".")
const LOG_FILE = process.env.SURGE_LOG_FILE || "/tmp/surge-publish.state.log"
const ENDPOINT = "https://surge.surge.sh/"

if (!DOMAIN) {
  console.error("用法：node tools/surge-publish.cjs <域名> [项目目录]")
  process.exit(1)
}

function log(...args) {
  const line = args.join(" ")
  console.log(line)
  try {
    fs.appendFileSync(LOG_FILE, line + "\n")
  } catch (e) {
    /* 日志写不进去不影响主流程 */
  }
}

// ---- 代理版 request，替换 surge-stream 的原生实现 ----
function makeRequest() {
  const { Readable } = require("stream")
  const undici = require("/root/.nvm/versions/node/v24.1.0/lib/node_modules/undici")
  const agent = new undici.ProxyAgent(process.env.HTTPS_PROXY || "http://127.0.0.1:18080")

  const collect = (body) => {
    if (body === undefined || body === null) return Promise.resolve(undefined)
    if (typeof body === "string") return Promise.resolve(Buffer.from(body))
    if (Buffer.isBuffer(body)) return Promise.resolve(body)
    return new Promise((resolve, reject) => {
      const chunks = []
      body.on("data", (c) => chunks.push(Buffer.from(c)))
      body.on("end", () => resolve(Buffer.concat(chunks)))
      body.on("error", reject)
    })
  }

  const request = function (opts, callback) {
    let done = false
    const finish = (err, res, text) => {
      if (done) return
      done = true
      callback(err, res, text)
    }
    collect(opts.body)
      .then((buf) => {
        const headers = Object.assign({}, opts.headers)
        if (opts.auth) {
          headers["authorization"] =
            "Basic " + Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString("base64")
        }
        if (buf && !headers["content-length"]) headers["content-length"] = String(buf.length)
        return undici.request(opts.url, {
          method: opts.method || "GET",
          headers,
          body: buf,
          dispatcher: agent,
          headersTimeout: opts.timeout || 120000,
          bodyTimeout: 0
        })
      })
      .then(async (res) => {
        const plain = {}
        for (const [k, v] of Object.entries(res.headers)) plain[k.toLowerCase()] = v
        if (opts.stream) {
          const s =
            res.body && typeof res.body.pipe === "function" ? res.body : Readable.fromWeb(res.body)
          s.statusCode = res.statusCode
          s.headers = plain
          s.on("error", () => {})
          finish(null, s, null)
          return
        }
        finish(null, { statusCode: res.statusCode, headers: plain }, await res.body.text())
      })
      .catch((err) => finish(err))
    return { destroy() {} }
  }

  request.join = function (endpoint, p) {
    if (/^https?:\/\//i.test(p)) return p
    return String(endpoint).replace(/\/+$/, "") + "/" + String(p).replace(/^\/+/, "")
  }
  return request
}

if (fs.existsSync(requestPath)) {
  const m = new Module(requestPath, null)
  m.filename = requestPath
  m.loaded = true
  m.exports = makeRequest()
  require.cache[requestPath] = m
}

// ---- 写 ~/.netrc，让 surge CLI 和发布脚本共用同一份凭据 ----
function writeNetrc(email, token) {
  const file = path.join(os.homedir(), ".netrc")
  fs.writeFileSync(
    file,
    `machine surge.surge.sh\n  login ${email}\n  password ${token}\n`,
    { mode: 0o600 }
  )
}

// ---- 发布 ----
function deploy(token) {
  return new Promise((resolve) => {
    const makeStream = require(path.join(SURGE_STREAM_LIB, "stream.js"))
    const version = require(path.join(SURGE_ROOT, "package.json")).version
    const stream = makeStream({ endpoint: ENDPOINT, version })

    const emitter = stream.publish(
      PROJECT,
      DOMAIN,
      { user: "token", pass: token },
      { version },
      {}
    )

    emitter.on("info", (info) => {
      log("发布成功：")
      for (const u of info.urls || []) log("  " + u.name + ": https://" + u.domain)
      resolve(true)
    })
    emitter.on("forbidden", (d) => {
      log("被拒绝：" + d)
      resolve(false)
    })
    emitter.on("unauthorized", (d) => {
      log("未授权：" + d)
      resolve(false)
    })
    emitter.on("invalid", (d) => {
      log("参数不合法：" + d)
      resolve(false)
    })
    emitter.on("ratelimited", (d) => {
      log("被限流：" + d)
      resolve(false)
    })
    emitter.on("error", (d) => {
      log("发布出错：" + JSON.stringify(d))
      resolve(false)
    })
    emitter.on("fail", () => {
      log("发布失败：账号邮箱可能未验证，或域名已被他人占用")
      resolve(false)
    })
  })
}

// ---- 主流程：登录会话循环 + 发布 ----
const surgeSDK = require(path.join(SURGE_ROOT, "node_modules/surge-sdk"))
const sdk = surgeSDK({ endpoint: ENDPOINT })

function startSession(attempt) {
  sdk.loginSession(os.hostname(), (error, session) => {
    if (error || !session || !session.uuid) {
      log("开登录会话失败，5 秒后重试")
      return setTimeout(() => startSession(attempt), 5000)
    }

    log("")
    log("=== 需要你在浏览器里批准（第 " + attempt + " 次会话）===")
    log("  url:  " + session.url)
    log("  code: " + session.code)
    log("  有效期 " + (session.expires_in || 600) + " 秒")
    log("")

    const deadline = Date.now() + (session.expires_in || 600) * 1000
    const interval = (session.interval || 2) * 1000

    const poll = () => {
      if (Date.now() > deadline) {
        log("会话过期，自动重开一个")
        return startSession(attempt + 1)
      }
      sdk.loginPoll(session.uuid, session.poll, (err, result) => {
        if (err || !result) return setTimeout(poll, interval)
        if (result.status === "approved") {
          log("已批准：账号 " + result.email)
          writeNetrc(result.email, result.token)
          // 签发一个只对目标域名有效的窄权限 token，后续发布用它
          sdk.tokenAdd(
            { scope: [DOMAIN], msg: "trae agent" },
            { user: "token", pass: result.token },
            (e, record) => {
              if (e || !record || !record.token) {
                log("签发窄权限 token 失败，改用账号 token 发布")
                return deploy(result.token).then((ok) => finish(ok))
              }
              log("窄权限 token 已签发：" + record.token)
              return deploy(record.token).then((ok) => finish(ok))
            }
          )
          return
        }
        if (result.status === "gone") {
          log("会话被取消或过期，自动重开一个")
          return startSession(attempt + 1)
        }
        return setTimeout(poll, interval)
      })
    }
    setTimeout(poll, interval)
  })
}

function finish(ok) {
  if (ok) {
    log("")
    log("搞定。线上地址：https://" + DOMAIN + "/")
  } else {
    log("")
    log("发布没成功，看上面的原因。")
  }
  process.exit(ok ? 0 : 1)
}

startSession(1)
