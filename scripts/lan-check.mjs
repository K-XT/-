import os from 'node:os';
import net from 'node:net';

const PORT = Number(process.env.PORT || 4173);
const VIRTUAL_PREFIXES = ['utun', 'awdl', 'llw', 'bridge', 'vmnet', 'veth', 'docker', 'tun', 'tap'];

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

function probe(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

const addresses = lanAddresses();

process.stdout.write(`\n零号提交 · 局域网自检（端口 ${PORT}）\n\n网卡（IPv4，已排除虚拟网卡）\n`);
if (addresses.length === 0) {
  process.stdout.write('  未发现局域网地址：确认已连接 Wi-Fi 或网线。\n');
}
for (const item of addresses) {
  process.stdout.write(`  ${item.name.padEnd(8)} ${item.address}\n`);
}

const localUp = await probe('127.0.0.1', PORT);
process.stdout.write(`\n本机 127.0.0.1:${PORT}  ${localUp ? '可连接' : '不可连接'}\n`);

const results = [];
for (const item of addresses) {
  const up = await probe(item.address, PORT);
  results.push({ ...item, up });
  process.stdout.write(`局域网 ${item.address}:${PORT}  ${up ? '可连接' : '不可连接'}\n`);
}

process.stdout.write('\n');

if (!localUp) {
  process.stdout.write('结论：服务没有在运行。先在项目目录执行 npm start。\n\n');
  process.exit(1);
}

const reachable = results.filter((item) => item.up);
if (reachable.length === 0) {
  process.stdout.write('结论：服务只监听在本机回环地址，其他设备连不上。\n');
  process.stdout.write('处理：停掉当前进程，改用 npm start（默认 HOST=0.0.0.0），不要带 HOST=127.0.0.1。\n\n');
  process.exit(1);
}

process.stdout.write('结论：服务已在局域网地址上监听。手机仍打不开时，按顺序检查：\n');
process.stdout.write('  1. 手机与电脑是否同一 Wi-Fi（不是访客网络、不是 5G 蜂窝）\n');
process.stdout.write('  2. 路由器是否开启 AP 隔离 / 客户端隔离\n');
process.stdout.write('  3. macOS 防火墙是否放行 node（系统设置 → 网络 → 防火墙）\n');
process.stdout.write('  4. macOS 15+ 是否允许终端访问本地网络（隐私与安全性 → 本地网络）\n');
process.stdout.write('  5. 是否开着 VPN / 代理（Clash 等会劫持局域网路由）\n');
process.stdout.write(`  6. 手机浏览器访问：${reachable.map((item) => `http://${item.address}:${PORT}/`).join(' 或 ')}\n\n`);