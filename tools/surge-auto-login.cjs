// 在 GitHub Actions 里常驻运行：开一个 surge 浏览器登录会话，把链接写进 issue，
// 等你批准后自动发布 traebao-app.surge.sh。
//
// 为什么要这套东西：surge 的浏览器登录会话只有 10 分钟有效期，手工发链接
// 总会过期。放在 Actions 里循环开新会话，issue 上的链接永远是新鲜的，
// 而且批准之后 token 会缓存下来，之后再发布不需要再登录。
//
// 用法（本地也能跑）：
//   GITHUB_TOKEN=<github token> SURGE_DOMAIN=traebao-app.surge.sh node tools/surge-auto-login.cjs

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const DOMAIN = process.env.SURGE_DOMAIN || "traebao-app.surge.sh"
const ENDPOINT = "https://surge.surge.sh/"
const REPO = process.env.GITHUB_REPOSITORY || "zhengfan1017/meet"
const GH_TOKEN = process.env.GITHUB_TOKEN
const ISSUE_NUMBER = Number(process.env.SURGE_ISSUE || "1")
const TOKEN_FILE = process.env.SURGE_TOKEN_FILE || path.join(os.tmpdir(), "surge-token.txt")
const HOST = process.env.SURGE_HOST || "github-actions"
const RUN_MINUTES = Number(process.env.SURGE_RUN_MINUTES || 55)
const MARKER = "<!-- surge-login -->"

const [OWNER, REPO_NAME] = REPO.split("/")

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- surge 登录会话 ----------

async function surgeApi(pathname, body) {
  const res = await fetch(ENDPOINT.replace(/\/+$/, "") + "/" + pathname.replace(/^\/+/, ""), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch (e) {
    return { status: "error", message: text }
  }
}

async function openSession() {
  return surgeApi("login/session", { host: HOST })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 轮询直到批准 / 过期；期间每 8 分钟重开一个新会话，保证链接新鲜
let lastUrl = ""

async function waitForApproval() {
  const hardDeadline = Date.now() + RUN_MINUTES * 60 * 1000
  while (Date.now() < hardDeadline) {
    const session = await openSession()
    if (!session || !session.uuid) {
      log("开会话失败：", JSON.stringify(session))
      await sleep(15000)
      continue
    }
    const deadline = Date.now() + Math.min(9.5 * 60 * 1000, hardDeadline - Date.now())
    log("新会话：", session.url)
    lastUrl = session.url
    await upsertComment(
      `🔗 **点这个链接登录 Surge**（10 分钟内有效，页面上没有 code 框，只填邮箱+密码，或点 Continue with Google / GitHub）\n\n` +
        `<${session.url}>\n\n` +
        `登录后本任务会自动发布。当前时间 ${new Date().toLocaleString("zh-CN")}`
    )
    while (Date.now() < deadline) {
      await sleep((session.interval || 2) * 1000)
      let poll
      try {
        poll = await surgeApi(`login/session/${session.uuid}/poll`, { poll: session.poll })
      } catch (e) {
        continue
      }
      if (poll && poll.status === "approved") return poll
      if (poll && poll.status === "gone") {
        log("会话被取消")
        break
      }
    }
    log("会话过期，重开一个")
  }
  return null
}

// ---------- GitHub issue：链接的展示位 ----------

async function gh(pathname, method = "GET", body) {
  const res = await fetch("https://api.github.com" + pathname, {
    method,
    headers: {
      authorization: "Bearer " + GH_TOKEN,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(method + " " + pathname + " -> " + res.status + " " + text.slice(0, 200))
  return text ? JSON.parse(text) : null
}

async function upsertComment(body) {
  if (!GH_TOKEN) {
    log("没有 GITHUB_TOKEN，跳过 issue 更新：\n" + body)
    return
  }
  try {
    const comments = await gh(`/repos/${OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}/comments?per_page=100`)
    const mine = (comments || []).find((c) => (c.body || "").includes(MARKER))
    if (mine) {
      await gh("/repos/" + OWNER + "/" + REPO_NAME + "/issues/comments/" + mine.id, "PATCH", {
        body: MARKER + "\n" + body
      })
    } else {
      await gh(`/repos/${OWNER}/${REPO_NAME}/issues/${ISSUE_NUMBER}/comments`, "POST", {
        body: MARKER + "\n" + body
      })
    }
  } catch (e) {
    log("更新 issue 失败：", e.message)
  }
}

// ---------- 发布 ----------

function deploy(token) {
  return new Promise((resolve) => {
    const cp = spawn("surge", ["--token", token, "--project", ".", "--domain", DOMAIN], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    })
    let out = ""
    cp.stdout.on("data", (d) => (out += d))
    cp.stderr.on("data", (d) => (out += d))
    cp.on("error", (e) => resolve({ ok: false, out: out + e.message }))
    cp.on("close", (code) => {
      const ok = code === 0 && /Success/i.test(out) && !/Invalid token|Unauthorized|forbidden/i.test(out)
      resolve({ ok, out })
    })
  })
}

async function verifyLive() {
  try {
    const res = await fetch("https://" + DOMAIN + "/sw.js", { cache: "no-store" })
    const text = await res.text()
    const m = text.match(/traebao-v\d+/)
    return { ok: !!m, version: m ? m[0] : "?" }
  } catch (e) {
    return { ok: false, version: "?" }
  }
}

// ---------- 主流程 ----------

async function main() {
  // 1) 有缓存 token 就直接发布，不用再走登录
  if (fs.existsSync(TOKEN_FILE)) {
    const token = fs.readFileSync(TOKEN_FILE, "utf8").trim()
    if (token) {
      log("发现缓存的 token，直接发布")
      const r = await deploy(token)
      if (r.ok) {
        const v = await verifyLive()
        log("发布结果：", r.out.trim().split("\n").slice(-3).join(" "), "| 线上 SW：", v.version)
        await upsertComment("✅ **已发布** " + DOMAIN + "（SW " + v.version + "）")
        return
      }
      log("缓存 token 失效，转登录流程：", r.out.trim().split("\n").slice(-2).join(" "))
      fs.rmSync(TOKEN_FILE, { force: true })
    }
  }

  // 2) 否则开会话，等用户批准
  const approved = await waitForApproval()
  if (!approved) {
    log("本轮没等到批准")
    // 别把链接冲掉：轮次结束时评论里还得留着可点的链接
    await upsertComment(
      "⏳ 本轮没等到登录批准。下面这条链接仍然可以点，登录后本任务会自动发布。\n\n" +
        (lastUrl ? `<${lastUrl}>\n\n` : "") +
        `当前时间 ${new Date().toLocaleString("zh-CN")}`
    )
    return
  }

  log("已批准，账号：" + approved.email)
  fs.writeFileSync(TOKEN_FILE, approved.token, { mode: 0o600 })

  const r = await deploy(approved.token)
  if (!r.ok) {
    log("发布失败：", r.out.trim())
    await upsertComment("❌ **发布失败**\n\n```\n" + r.out.trim().slice(-500) + "\n```")
    process.exitCode = 1
    return
  }
  const v = await verifyLive()
  log("发布成功，线上 SW：" + v.version)
  await upsertComment(
    "✅ **已发布** " + DOMAIN + "（SW " + v.version + "）\n\ntoken 已缓存，下次发布不用再登录。"
  )
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
