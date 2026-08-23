// Minimal local server for the Work Permits app.
// Serves the front-end (public/) over HTTPS (self-signed cert, auto-generated
// on first run) and provides a tiny key-value storage API backed by a JSON
// file (data/storage.json), replacing Claude.ai's window.storage.
//
// HTTPS is required (not just "nice to have") because PWA installability
// (service worker registration + the "Add to Home Screen" prompt) only works
// in a browser "secure context" — and a plain http:// address on the local
// WiFi network does NOT count as secure. A self-signed certificate does,
// once you accept the one-time browser warning on each device.

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const selfsigned = require('selfsigned');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTP_REDIRECT_PORT = process.env.HTTP_PORT || 3080;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');
const CERT_DIR = path.join(__dirname, 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
  } catch (e) {
    console.error('Failed to read storage file, starting fresh:', e);
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function getAllLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

async function ensureCertificate() {
  if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) {
    return {
      key: fs.readFileSync(KEY_FILE),
      cert: fs.readFileSync(CERT_FILE)
    };
  }

  console.log('🔐  أول تشغيل: بنولّد شهادة HTTPS محلية (مرة واحدة بس)...');

  const localIps = getAllLocalIps();
  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' }     // IP
  ];
  for (const ip of localIps) {
    altNames.push({ type: 7, ip });
  }

  const attrs = [{ name: 'commonName', value: 'work-permits.local' }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      { name: 'subjectAltName', altNames }
    ]
  });

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, pems.private, 'utf8');
  fs.writeFileSync(CERT_FILE, pems.cert, 'utf8');

  return { key: pems.private, cert: pems.cert };
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/storage/:key -> { key, value }
app.get('/api/storage/:key', (req, res) => {
  const store = readStore();
  const key = req.params.key;
  if (!(key in store)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ key, value: store[key] });
});

// POST /api/storage/:key  body: { value }
app.post('/api/storage/:key', (req, res) => {
  const store = readStore();
  const key = req.params.key;
  store[key] = req.body.value;
  writeStore(store);
  res.json({ key, value: store[key] });
});

// DELETE /api/storage/:key
app.delete('/api/storage/:key', (req, res) => {
  const store = readStore();
  const key = req.params.key;
  const existed = key in store;
  delete store[key];
  writeStore(store);
  res.json({ key, deleted: existed });
});

async function startServer() {
  const { key, cert } = await ensureCertificate();
  const httpsServer = https.createServer({ key, cert }, app);

  // Small plain-HTTP server that just redirects to HTTPS, so people who type
  // "http://..." out of habit still land on the right (installable) page.
  const redirectApp = http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').split(':')[0];
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
    res.end();
  });

  httpsServer.listen(PORT, '0.0.0.0', () => {
    const ips = getAllLocalIps();
    console.log('');
    console.log('✅  تصاريح العمل - السيرفر شغال (HTTPS)');
    console.log('----------------------------------------');
    console.log(`   على نفس الجهاز:   https://localhost:${PORT}`);
    if (ips.length === 0) {
      console.log('   (مفيش شبكة واي فاي متصلة - وصلّه بالواي فاي عشان الموبايلات تعرف تدخل)');
    }
    for (const ip of ips) {
      console.log(`   من موبايل/جهاز تاني على نفس الواي فاي:   https://${ip}:${PORT}`);
    }
    console.log('----------------------------------------');
    console.log('⚠️  أول مرة تفتح اللينك من أي جهاز، المتصفح هيبين تحذير "الاتصال غير آمن"');
    console.log('    لأن الشهادة ذاتية التوقيع (مش من جهة معتمدة) - ده متوقع وطبيعي.');
    console.log('    دوس "Advanced" / "متقدم" ثم "Proceed" / "المتابعة"، وهيفتح عادي بعدها.');
    console.log('----------------------------------------');
    console.log('البيانات بتتخزن في data/storage.json');
    console.log('');
  });

  redirectApp.listen(HTTP_REDIRECT_PORT, '0.0.0.0', () => {
    console.log(`(تحويل تلقائي من http على بورت ${HTTP_REDIRECT_PORT} إلى https على بورت ${PORT})`);
  });
}

startServer().catch((e) => {
  console.error('فشل تشغيل السيرفر:', e);
  process.exit(1);
});
