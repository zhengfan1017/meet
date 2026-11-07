// 发布到 surge.sh
//
//   node tools/deploy-surge.cjs <域名> [项目目录]
//
// 环境相关的坑，这个脚本都绕开了：
//
// 1. surge-stream 用原生 https.request，不认 HTTPS_PROXY 代理环境变量；
//    沙箱出口必须走代理时，请求会直接失败。设了代理就把它的 request 模块
//    换成走 undici ProxyAgent 的版本，没设代理就用原生实现。
// 2. surge-stream 装在全局 npm 目录下，路径跟着 node 版本走；
//    这里按当前 node 的安装位置动态找，不写死版本号。

const path = require("path")
const Module = require("module")
const fs = require("fs")
const { execFileSync } = require("child_process")

function findSurgeStream() {
  const candidates = []
  // 当前 node 的全局 node_modules
  const globalRoot = path.dirname(path.dirname(process.execPath))
  candidates.push(path.join(globalRoot, "lib", "node_modules", "surge", "node_modules", "surge-stream", "lib"))
  // npm root -g（nvm 等场景下更准）
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()
    candidates.push(path.join(root, "surge", "node_modules", "surge-stream", "lib"))
  } catch (e) {
    // npm 不在 PATH 上就算了，靠上面的候选
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "stream.js"))) return dir
  }
  console.error("找不到 surge-stream，先跑 `npm install -g surge`")
  process.exit(1)
}

const SURGE_HOME = findSurgeStream()
const requestPath = path.join(SURGE_HOME, "request.js")

const TOKEN = process.env.SURGE_TOKEN
const DOMAIN = process.argv[2]
const PROJECT = path.resolve(process.argv[3] || ".")

if (!TOKEN) {
  console.error("缺少 SURGE_TOKEN 环境变量（surge token 命令可拿到）")
  process.exit(1)
}
if (!DOMAIN) {
  console.error("用法：node tools/deploy-surge.cjs <域名> [项目目录]")
  process.exit(1)
}

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy

// ---- 代理版 request，替换 surge-stream 的原生实现 ----
function makeRequest() {
  const { Readable } = require("stream")
  const undici = loadUndici()
  const agent = new undici.ProxyAgent(PROXY)

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

function loadUndici() {
  try {
    return require("undici")
  } catch (e) {
    // undici 不在项目依赖里，找全局 node_modules
    const globalRoot = path.dirname(path.dirname(process.execPath))
    const p = path.join(globalRoot, "lib", "node_modules", "undici")
    if (fs.existsSync(p)) return require(p)
    throw new Error("找不到 undici，装一个：npm install -g undici")
  }
}

if (PROXY && fs.existsSync(requestPath)) {
  const m = new Module(requestPath, null)
  m.filename = requestPath
  m.loaded = true
  m.exports = makeRequest()
  require.cache[requestPath] = m
}

const makeStream = require(path.join(SURGE_HOME, "stream.js"))
// 版本号跟着已安装的 surge CLI 走，surge 升级后不用再手动改这里
const SURGE_VERSION = require(path.join(SURGE_HOME, "..", "..", "..", "package.json")).version
const stream = makeStream({ endpoint: "https://surge.surge.sh/", version: SURGE_VERSION })

const emitter = stream.publish(
  PROJECT,
  DOMAIN,
  { user: "token", pass: TOKEN },
  { version: SURGE_VERSION },
  {}
)

emitter.on("info", (info) => {
  console.log("发布成功：")
  for (const u of info.urls || []) console.log("  " + u.name + ": https://" + u.domain)
})
emitter.on("forbidden", (d) => {
  console.error("被拒绝：" + d)
  process.exit(1)
})
emitter.on("unauthorized", (d) => {
  console.error("未授权：" + d)
  process.exit(1)
})
emitter.on("invalid", (d) => {
  console.error("参数不合法：" + d)
  process.exit(1)
})
emitter.on("error", (d) => {
  console.error("发布出错：" + JSON.stringify(d))
  process.exit(1)
})
emitter.on("fail", () => {
  console.error("发布失败：账号邮箱可能未验证，或域名已被他人占用")
  process.exit(1)
})
