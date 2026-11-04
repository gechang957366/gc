// 局域网静态服务器：node serve.mjs [端口]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.argv[2] || 8099)
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' }

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  let path = decodeURIComponent(url.pathname)
  if (path === '/' || path === '') path = '/index.html'
  const target = resolve(ROOT, '.' + normalize(path))
  if (!target.startsWith(ROOT) || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404')
    return
  }
  const body = readFileSync(target)
  res.writeHead(200, {
    'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}).listen(PORT, '0.0.0.0', () => {
  console.log('每周文献速递（在线版）已启动：')
  console.log('  本机     http://127.0.0.1:' + PORT + '/')
  console.log('  局域网   把本机 IP 发给同事，端口 ' + PORT)
  console.log('更新数据：替换 data/ 下的文件后刷新页面即可，不用重启')
})
