import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, json } from './routes.js';
import { handleStream } from './stream.js';
import { SESSION_TTL_MS } from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const VIRTUAL_PREFIXES = ['utun', 'awdl', 'llw', 'bridge', 'vmnet', 'veth', 'docker', 'tun', 'tap'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const ALIAS = new Map([
  ['/', 'index.html'],
  ['/student', 'index.html'],
  ['/screen', 'screen.html'],
  ['/admin', 'admin.html'],
]);

function lanAddresses() {
  const addresses = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push({ name, address: item.address });
    }
  }
  return addresses;
}

const isLoopback = (host) => host === '127.0.0.1' || host === '::1' || host === 'localhost';

function serveStatic(req, res, pathname) {
  let relative = ALIAS.get(pathname);
  if (!relative) {
    relative = decodeURIComponent(pathname.replace(/^\/+/, ''));
  }
  if (!relative) relative = 'index.html';

  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    json(res, 403, { ok: false, code: 'forbidden', message: '路径不合法' });
    return;
  }

  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      json(res, 404, { ok: false, code: 'not_found', message: `未找到资源：${pathname}` });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=60',
    });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/stream') {
    handleStream(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, url);
      if (!handled) {
        json(res, 404, { ok: false, code: 'not_found', message: `未知接口：${url.pathname}` });
      }
    } catch (error) {
      if (!res.headersSent) {
        json(res, 500, { ok: false, code: 'internal_error', message: error.message });
      } else {
        res.end();
      }
    }
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.on('error', (error) => {
  const hints = {
    EADDRINUSE: `端口 ${PORT} 已被占用。换一个端口：PORT=4180 npm start`,
    EACCES: `没有权限监听 ${PORT}。改用 1024 以上端口：PORT=4180 npm start`,
    EPERM: '系统拒绝监听该端口：可能被安全软件或沙箱限制。尝试 PORT=4180 或换一台机器',
    EADDRNOTAVAIL: `地址 ${HOST} 不属于本机网卡。改用 HOST=0.0.0.0 npm start`,
  };
  process.stderr.write(`\n  启动失败：${error.code ?? error.message}\n  ${hints[error.code] ?? error.message}\n\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const passcode = process.env.GM_PASSCODE || 'linghao2026';
  const addresses = lanAddresses();
  const lines = ['', '  零号提交 · 互动选角系统', `  监听     ${HOST}:${PORT}`];

  if (isLoopback(HOST)) {
    lines.push('  ⚠ 仅本机可访问：当前绑定在回环地址，手机与大屏连不上。');
    lines.push('     用 npm start（默认 0.0.0.0），或 HOST=0.0.0.0 npm start');
  }

  lines.push(`  本机     http://localhost:${PORT}/`);

  if (addresses.length === 0) {
    lines.push('  ⚠ 未检测到局域网 IPv4 地址：确认已连接 Wi-Fi 或网线。');
  } else {
    for (const item of addresses) {
      lines.push(`  局域网   http://${item.address}:${PORT}/   (${item.name})`);
    }
    const first = addresses[0].address;
    lines.push(`  大屏     http://${first}:${PORT}/screen`);
    lines.push(`  控制台   http://${first}:${PORT}/admin`);
  }

  lines.push(`  GM 口令  ${passcode}（登录后签发 ${Math.round(SESSION_TTL_MS / 3600000)} 小时会话）`);
  lines.push('');
  lines.push('  手机连不上时运行：npm run lan');
  lines.push('');

  process.stdout.write(lines.join('\n'));
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);