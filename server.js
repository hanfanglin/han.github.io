#!/usr/bin/env node
/* ============================================================
 * 利润记账 · 云同步服务端（零依赖，单文件）
 * ------------------------------------------------------------
 * 部署（Render.com 免费版为例）：
 *   1. 新建 Web Service，连上你的 GitHub 仓库
 *   2. Build Command:  留空（或 echo ok）
 *      Start Command:  node server.js
 *   3. 环境变量：
 *      TOKEN = 你的同步密钥（自定义一串随机字符，客户端要用同一个）
 *      PORT  = 端口（Render 自动注入，本地测试默认 8640）
 *   4. 部署完成后把 https://xxx.onrender.com 填进 App 设置 → 云同步
 *
 * 接口：
 *   GET  /health            健康检查（免鉴权）
 *   GET  /sync?token=xxx    拉取数据
 *   POST /sync?token=xxx    推送数据（整体覆盖，JSON 上限 5MB）
 * 数据保存在服务端 data.json，带原子写入与写队列，不会写坏。
 * ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 8640);
const TOKEN = process.env.TOKEN || '';
const DATA_FILE = path.join(__dirname, 'data.json');
const MAX_BODY = 5 * 1024 * 1024; // 5MB

if (!TOKEN) {
  console.error('[启动失败] 必须设置环境变量 TOKEN（同步密钥），例如：TOKEN=abc123 node server.js');
  process.exit(1);
}

/* ---- 数据存取：原子写 + 串行写队列 ---- */
let queue = Promise.resolve();
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    return {
      users: Array.isArray(d.users) ? d.users : [],
      sales: Array.isArray(d.sales) ? d.sales : [],
      archives: Array.isArray(d.archives) ? d.archives : [],
      tombs: (d.tombs && typeof d.tombs === 'object') ? d.tombs : {},
      rev: +d.rev || 1
    };
  } catch (e) { return { users: [], sales: [], archives: [], tombs: {}, rev: 1 }; }
}
function writeData(next) {
  queue = queue.then(() => new Promise((resolve) => {
    const tmp = DATA_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
      fs.renameSync(tmp, DATA_FILE); // 原子替换，断电也不会写半个文件
    } catch (e) { console.error('[写入失败]', e.message); }
    resolve();
  }));
  return queue;
}

/* ---- 鉴权：恒定时间比较 ---- */
function authOk(req, url) {
  const t = url.searchParams.get('token') || '';
  const a = Buffer.from(String(TOKEN)), b = Buffer.from(String(t));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/health') return send(res, 200, { ok: true, time: Date.now() });

  if (url.pathname !== '/sync') return send(res, 404, { ok: false, error: 'not found' });
  if (!authOk(req, url)) return send(res, 401, { ok: false, error: 'token 错误' });

  if (req.method === 'GET') {
    // 拉取
    return send(res, 200, Object.assign({ ok: true }, readData()));
  }

  if (req.method === 'POST') {
    // 推送：读取 body（上限保护）
    let size = 0, chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const cur = readData();
        const next = {
          users: Array.isArray(d.users) ? d.users : [],
          sales: Array.isArray(d.sales) ? d.sales : [],
          archives: Array.isArray(d.archives) ? d.archives : [],
          tombs: (d.tombs && typeof d.tombs === 'object') ? d.tombs : {},
          rev: cur.rev + 1
        };
        writeData(next);
        return send(res, 200, { ok: true, rev: next.rev });
      } catch (e) {
        return send(res, 400, { ok: false, error: 'JSON 格式错误' });
      }
    });
    req.on('error', () => send(res, 400, { ok: false, error: '请求读取失败' }));
    return;
  }

  return send(res, 405, { ok: false, error: 'method not allowed' });
});

server.listen(PORT, () => {
  console.log(`[利润记账同步服务] 已启动  http://localhost:${PORT}`);
  console.log(`  数据文件: ${DATA_FILE}`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
});
