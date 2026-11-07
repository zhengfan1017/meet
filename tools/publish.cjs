// 一键发布到 surge.sh
//
//   node tools/publish.cjs [域名]
//
// token 存在仓库根目录的 surge-token.txt（已被 .gitignore 排除，不会上传到公网）。
// 换 token：surge login 后跑 `surge token`，或 POST https://surge.surge.sh/token
// 换来的 token 写进 surge-token.txt 即可。
//
// 为什么不再走浏览器登录：surge 的登录会话只有 10 分钟有效，每小时重发一次链接
// 太折腾，而且 App 令牌也没法把 token 存进 Actions secret。本地存 token 一步到位。

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const TOKEN_FILE = path.join(ROOT, "surge-token.txt")
const DOMAIN = process.argv[2] || "traebao-app-2.surge.sh"

if (!fs.existsSync(TOKEN_FILE)) {
  console.error("找不到 " + TOKEN_FILE)
  console.error("先跑 `surge login` 拿到 token，然后写进这个文件（一行一个 token）")
  process.exit(1)
}

const token = fs.readFileSync(TOKEN_FILE, "utf8").trim().split("\n")[0].trim()
if (!token) {
  console.error(TOKEN_FILE + " 是空的")
  process.exit(1)
}

console.log("发布到 https://" + DOMAIN)

const r = spawnSync(
  process.execPath,
  [path.join(ROOT, "tools", "deploy-surge.cjs"), DOMAIN, ROOT],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: Object.assign({}, process.env, { SURGE_TOKEN: token })
  }
)

if (r.status !== 0) {
  console.error("\n发布失败。若提示域名不属于本账号，说明这个域名绑在别的 surge 账号上。")
  process.exit(r.status || 1)
}

console.log("\n完成：https://" + DOMAIN)
