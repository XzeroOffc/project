import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import session from 'express-session';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,      
    crossOriginEmbedderPolicy: false, 
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Terlalu banyak request dari IP ini, coba lagi nanti.'
});

const createPaymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak pembuatan pembayaran, tunggu 5 menit.'
});

const limitAdmin = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak request dari IP ini, coba lagi nanti.'
});

app.use('/api/', limiter);
app.use('/admin/', limitAdmin);
app.use('/api/payment/create', createPaymentLimiter);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// === KONFIGURASI ===
const CONFIG = {
  storename: "ZeronePedia",
  pakasir: {
    project: "tele",
    apiKey: "xCHn6xbNmfob4sjxfDa9qmsOU5IKUqIr"
  },
  
  cloudflare: {
    secretkey: "0x4AAAAAACbExPX_ZQhg2Sr_bnvBlIuhA9A", // secretkey dari cloudflare
    sitekey: "0x4AAAAAACbExGMifUbMGxuY" // sitekey dari cloudflare
  }, 
  
  pterodactyl: {
    domain: "https://panel.example.com", // domain panel
    apiKey: "ptla_mu", // apikey plta
    nestId: "5", // nest id bot whatsapp
    eggId: "15", // egg id bot whatsapp
    locationId: "1" // location id
  },
  
  telegram: {
    botToken: "8502011586:AAGkj2TBwotggJ06LeG2SQinf75IsGNljcc", // bot telegram token (@BotFather)
    chatId: "1485362700", // id telegram utama
    logChannels: {
      payments: "-1003722488926", // channel untuk log pembayaran
      servers: "-1003722488926", // channel untuk log server
      errors: "-1003722488926" // channel untuk log error
    }
  },
  
  warranty: {
    enabled: true, // aktifkan sistem garansi
    tokenLength: 32, // panjang token garansi
    expiryDays: 30, // masa berlaku token (hari)
    maxUses: 1 // maksimal penggunaan token
  },
  
  admin: {
    username: "admin", // username untuk login atmin
    password: "admin123" // password untuk login atmin
  },
  
  prices: {
    "1gb": 1000,
    "2gb": 2000,
    "3gb": 3000,
    "4gb": 4000,
    "5gb": 5000,
    "6gb": 6000,
    "7gb": 7000,
    "8gb": 8000,
    "9gb": 9000,
    "10gb": 10000,
    "unlimited": 12000
  } // ini default pricenya
};

const specs = {
  "1gb": { ram: 1000, disk: 5000, cpu: 40 },
  "2gb": { ram: 2000, disk: 10000, cpu: 60 },
  "3gb": { ram: 3000, disk: 15000, cpu: 80 },
  "4gb": { ram: 4000, disk: 20000, cpu: 100 },
  "5gb": { ram: 5000, disk: 25000, cpu: 120 },
  "6gb": { ram: 6000, disk: 30000, cpu: 140 },
  "7gb": { ram: 7000, disk: 35000, cpu: 160 },
  "8gb": { ram: 8000, disk: 40000, cpu: 180 },
  "9gb": { ram: 9000, disk: 45000, cpu: 200 },
  "10gb": { ram: 10000, disk: 50000, cpu: 220 },
  "unlimited": { ram: 0, disk: 0, cpu: 0 }
}; // spek default

// === DATABASE SEDERHANA (In-memory) ===
const db = {
  warrantyTokens: new Map(), // token -> { serverId, createdAt, expiresAt, used }
  serverLogs: new Map(), // serverId -> [{ timestamp, action, details }]
  paymentLogs: [], // array of payment logs
  errorLogs: [] // array of error logs
};

// === FUNGSI BANTU ===
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>"'&]/g, (char) => {
    const entities = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;' };
    return entities[char];
  });
}

function isValidUsername(username) {
  return /^[a-z0-9]{3,16}$/.test(username);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// === FUNGSI TOKEN GARANSI ===
function generateWarrantyToken() {
  return crypto.randomBytes(CONFIG.warranty.tokenLength).toString('hex');
}

async function createWarrantyToken(serverId, username) {
  const token = generateWarrantyToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONFIG.warranty.expiryDays * 24 * 60 * 60 * 1000);
  
  db.warrantyTokens.set(token, {
    serverId,
    username,
    createdAt: now,
    expiresAt,
    used: false,
    usedAt: null
  });
  
  // Log ke Telegram
  await sendTelegramLog('servers', `🔧 <b>TOKEN GARANSI DIBUAT</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n👤 <b>User:</b> ${username}\n🆔 <b>Server ID:</b> ${serverId}\n📅 <b>Berlaku:</b> ${expiresAt.toLocaleDateString('id-ID')}\n⏰ <b>Waktu:</b> ${now.toLocaleTimeString('id-ID')}`);
  
  return token;
}

async function validateWarrantyToken(token, serverId) {
  const tokenData = db.warrantyTokens.get(token);
  
  if (!tokenData) {
    await sendTelegramLog('errors', `❌ <b>TOKEN GARANSI INVALID</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n🆔 <b>Server ID:</b> ${serverId}\n❌ <b>Status:</b> Token tidak ditemukan`);
    return { valid: false, message: 'Token tidak valid' };
  }
  
  if (tokenData.used) {
    await sendTelegramLog('errors', `❌ <b>TOKEN GARANSI SUDAH DIGUNAKAN</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n👤 <b>User:</b> ${tokenData.username}\n🆔 <b>Server ID:</b> ${serverId}\n⏰ <b>Digunakan pada:</b> ${tokenData.usedAt?.toLocaleString('id-ID') || 'Unknown'}`);
    return { valid: false, message: 'Token sudah digunakan' };
  }
  
  if (new Date() > tokenData.expiresAt) {
    await sendTelegramLog('errors', `❌ <b>TOKEN GARANSI KADALUARSA</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n👤 <b>User:</b> ${tokenData.username}\n🆔 <b>Server ID:</b> ${serverId}\n📅 <b>Kadaluarsa:</b> ${tokenData.expiresAt.toLocaleDateString('id-ID')}`);
    return { valid: false, message: 'Token sudah kadaluarsa' };
  }
  
  if (tokenData.serverId !== serverId) {
    await sendTelegramLog('errors', `❌ <b>TOKEN GARANSI SERVER TIDAK COCOK</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n👤 <b>User:</b> ${tokenData.username}\n🆔 <b>Server ID Token:</b> ${tokenData.serverId}\n🆔 <b>Server ID Request:</b> ${serverId}`);
    return { valid: false, message: 'Token tidak cocok untuk server ini' };
  }
  
  // Mark token as used
  tokenData.used = true;
  tokenData.usedAt = new Date();
  db.warrantyTokens.set(token, tokenData);
  
  await sendTelegramLog('servers', `✅ <b>TOKEN GARANSI DIGUNAKAN</b>\n\n🆔 <b>Token:</b> <code>${token}</code>\n👤 <b>User:</b> ${tokenData.username}\n🆔 <b>Server ID:</b> ${serverId}\n⏰ <b>Waktu:</b> ${new Date().toLocaleTimeString('id-ID')}`);
  
  return { valid: true, message: 'Token valid', username: tokenData.username };
}

// === FUNGSI LOG TELEGRAM CHANNELS ===
async function sendTelegramLog(channelType, message) {
  try {
    let chatId = CONFIG.telegram.chatId;
    
    if (CONFIG.telegram.logChannels && CONFIG.telegram.logChannels[channelType]) {
      chatId = CONFIG.telegram.logChannels[channelType];
    }
    
    await fetch(`https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.error('Telegram log error:', err);
  }
}

// Fungsi lama untuk kompatibilitas
async function sendTelegramNotif(message) {
  await sendTelegramLog('payments', message);
}

// === FUNGSI LOGGING SISTEM ===
function addServerLog(serverId, action, details) {
  if (!db.serverLogs.has(serverId)) {
    db.serverLogs.set(serverId, []);
  }
  
  const logEntry = {
    timestamp: new Date(),
    action,
    details
  };
  
  db.serverLogs.get(serverId).push(logEntry);
}

function addPaymentLog(orderId, amount, status, details = {}) {
  db.paymentLogs.push({
    timestamp: new Date(),
    orderId,
    amount,
    status,
    details
  });
}

function addErrorLog(error, context = {}) {
  db.errorLogs.push({
    timestamp: new Date(),
    error: error.message || error,
    stack: error.stack,
    context
  });
}

// === FUNGSI PTERODACTYL ===
async function createPteroUser(username) {
  const email = `${username}@panel.store`;
  const password = username + crypto.randomBytes(4).toString('hex');
  
  const res = await fetch(`${CONFIG.pterodactyl.domain}/api/application/users`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.pterodactyl.apiKey}`
    },
    body: JSON.stringify({
      email,
      username: username.toLowerCase(),
      first_name: username,
      last_name: 'Server',
      language: 'en',
      password
    })
  });
  
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].detail);
  
  return { user: data.attributes, password };
}

async function createPteroServer(userId, username, plan) {
  const spec = specs[plan];
  const name = `${username} Server`;
  
  const eggRes = await fetch(
    `${CONFIG.pterodactyl.domain}/api/application/nests/${CONFIG.pterodactyl.nestId}/eggs/${CONFIG.pterodactyl.eggId}`,
    {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${CONFIG.pterodactyl.apiKey}`
      }
    }
  );
  const eggData = await eggRes.json();
  
  const res = await fetch(`${CONFIG.pterodactyl.domain}/api/application/servers`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.pterodactyl.apiKey}`
    },
    body: JSON.stringify({
      name,
      description: `Created at ${new Date().toLocaleString('id-ID')}`,
      user: userId,
      egg: parseInt(CONFIG.pterodactyl.eggId),
      docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
      startup: eggData.attributes.startup,
      environment: {
        INST: "npm",
        USER_UPLOAD: "0",
        AUTO_UPDATE: "0",
        CMD_RUN: "npm start"
      },
      limits: {
        memory: spec.ram,
        swap: 0,
        disk: spec.disk,
        io: 500,
        cpu: spec.cpu
      },
      feature_limits: {
        databases: 5,
        backups: 5,
        allocations: 5
      },
      deploy: {
        locations: [parseInt(CONFIG.pterodactyl.locationId)],
        dedicated_ip: false,
        port_range: []
      }
    })
  });
  
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].detail);
  
  const server = data.attributes;
  
  // Generate warranty token
  const warrantyToken = await createWarrantyToken(server.id, username);
  
  // Update server description dengan token
  await fetch(`${CONFIG.pterodactyl.domain}/api/application/servers/${server.id}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.pterodactyl.apiKey}`
    },
    body: JSON.stringify({
      description: `Created at ${new Date().toLocaleString('id-ID')}\nWarranty Token: ${warrantyToken}`
    })
  });
  
  // Add server log
  addServerLog(server.id, 'SERVER_CREATED', {
    userId,
    username,
    plan,
    warrantyToken
  });
  
  return { ...server, warrantyToken };
}

// === MIDDLEWARE ===
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

// ===== PAGES ROUTES =====
app.get('/', (req, res) => {
  res.render('index', { title: `${CONFIG.storename} - Home` });
});

app.get('/plans', (req, res) => {
  const plans = Object.keys(CONFIG.prices).map(key => ({
    id: key,
    name: key.toUpperCase(),
    price: CONFIG.prices[key],
    specs: specs[key]
  }));
  
  res.render('plans', { title: `${CONFIG.storename} - Plans`, plans });
});

app.get('/checkout/:plan', (req, res) => {
  const planId = req.params.plan;
  
  if (!CONFIG.prices[planId]) {
    return res.redirect('/plans');
  }
  
  res.render('checkout', {
    title: `${CONFIG.storename} - Checkout`,
    plan: {
      id: planId,
      name: planId.toUpperCase(),
      price: CONFIG.prices[planId],
      specs: specs[planId]
    }
  });
});

app.get('/payment/:orderId', (req, res) => {
  res.render('payment', {
    title: `${CONFIG.storename} - Payment`,
    orderId: req.params.orderId
  });
});

app.get('/success', (req, res) => {
  res.render('success', {
    title: `${CONFIG.storename} - Success`
  });
});

app.get('/upgrade/:serverId', (req, res) => {
  res.render('upgrade', {
    title: `${CONFIG.storename} - Upgrade`,
    serverId: req.params.serverId
  });
});

// ===== WARRANTY ROUTES =====
app.get('/warranty', (req, res) => {
  res.render('warranty', {
    title: `${CONFIG.storename} - Klaim Garansi`,
    success: false,
    error: null
  });
});

app.post('/warranty/claim', async (req, res) => {
  try {
    const { serverId, token } = req.body;
    
    if (!serverId || !token) {
      return res.render('warranty', {
        title: `${CONFIG.storename} - Klaim Garansi`,
        success: false,
        error: 'Server ID dan token wajib diisi'
      });
    }
    
    // Validasi token
    const validation = await validateWarrantyToken(token, serverId);
    
    if (!validation.valid) {
      return res.render('warranty', {
        title: `${CONFIG.storename} - Klaim Garansi`,
        success: false,
        error: validation.message
      });
    }
    
    res.render('warranty', {
      title: `${CONFIG.storename} - Klaim Garansi`,
      success: true,
      error: null,
      message: `Klaim garansi berhasil! Server ${serverId} akan di-reset dalam waktu 24 jam.`
    });
    
  } catch (err) {
    console.error('Warranty claim error:', err);
    res.render('warranty', {
      title: `${CONFIG.storename} - Klaim Garansi`,
      success: false,
      error: 'Terjadi kesalahan server. Silakan coba lagi nanti.'
    });
  }
});

// ===== ADMIN ROUTES =====
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { 
    title: `${CONFIG.storename} - Admin Login`,
    error: null,
    siteKey: CONFIG.cloudflare.sitekey
  });
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const turnstileResponse = req.body['cf-turnstile-response'];

  if (!turnstileResponse) {
    return res.render('admin/login', { 
      title: `${CONFIG.storename} - Admin Login`,
      error: 'Harap selesaikan verifikasi keamanan (Cloudflare)!' 
    });
  }

  try {
    const secretKey = CONFIG.cloudflare.secretkey;
    const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    
    const result = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: turnstileResponse
      })
    });

    const data = await result.json();

    if (!data.success) {
      return res.render('admin/login', { 
        title: `${CONFIG.storename} - Admin Login`,
        error: 'Verifikasi keamanan gagal, silakan refresh halaman.' 
      });
    }

    if (username === CONFIG.admin.username && password === CONFIG.admin.password) {
      req.session.isAdmin = true;
      req.session.adminUsername = username;
      return res.redirect('/admin/dashboard');
    }
    
    res.render('admin/login', { 
      title: `${CONFIG.storename} - Admin Login`,
      error: 'Username atau password salah!' 
    });

  } catch (err) {
    console.error(err);
    res.render('admin/login', { 
      title: `${CONFIG.storename} - Admin Login`,
      error: 'Terjadi kesalahan server saat verifikasi.' 
    });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin/dashboard', requireAuth, (req, res) => {
  res.render('admin/dashboard', {
    title: `${CONFIG.storename} - Admin Dashboard`,
    adminUsername: req.session.adminUsername
  });
});

// ===== PUBLIC API =====
app.get('/api/plans', (req, res) => {
  const plans = Object.keys(CONFIG.prices).map(key => ({
    id: key,
    name: key.toUpperCase(),
    price: CONFIG.prices[key],
    specs: specs[key]
  }));
  res.json({ success: true, plans });
});

app.post('/api/payment/create', async (req, res) => {
  try {
    let { plan, username, email, recaptchaResponse } = req.body;
    
    if (!recaptchaResponse) {
      return res.status(400).json({ 
        success: false, 
        message: 'Harap verifikasi keamanan (Cloudflare)' 
      });
    }
    
    const turnstileSecretKey = CONFIG.cloudflare.secretkey;
    const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    
    const turnstileRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: turnstileSecretKey,
        response: recaptchaResponse
      })
    });
    
    const turnstileData = await turnstileRes.json();
    
    if (!turnstileData.success) {
      console.error('Turnstile validation failed:', turnstileData['error-codes']);
      return res.status(400).json({ 
        success: false, 
        message: 'Verifikasi keamanan gagal/kadaluarsa. Silakan refresh halaman.' 
      });
    }
    
    username = sanitizeInput(username);
    email = sanitizeInput(email);
    
    if (!plan || !username || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Plan, username, dan email wajib diisi' 
      });
    }
    
    if (!isValidUsername(username)) {
      return res.status(400).json({
        success: false,
        message: 'Username harus 3-16 karakter, hanya huruf kecil dan angka'
      });
    }
    
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Format email tidak valid'
      });
    }
    
    if (!CONFIG.prices[plan]) {
      return res.status(400).json({ 
        success: false, 
        message: 'Plan tidak valid' 
      });
    }
    
    const amount = CONFIG.prices[plan];
    const orderId = `ZP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    
    const createRes = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: CONFIG.pakasir.project,
        api_key: CONFIG.pakasir.apiKey,
        order_id: orderId,
        amount
      })
    });
    
    const createData = await createRes.json();
    
    if (!createData || createData.error) {
      return res.status(500).json({ 
        success: false, 
        message: createData?.error || 'Gagal membuat transaksi QRIS' 
      });
    }
    
    const paymentCode = createData.code || createData.payment?.code;
    const qrisString = createData.qris_string || createData.payment?.qris_string || createData.payment?.payment_number;
    const paymentNumber = createData.payment_number || createData.payment?.payment_number;
    
    if (!paymentCode && !qrisString && !paymentNumber) {
      return res.status(500).json({ 
        success: false, 
        message: 'Format response QRIS tidak valid' 
      });
    }
    
    let qrisUrl;
    if (paymentCode) {
      qrisUrl = `https://app.pakasir.com/qris/${paymentCode}.png`;
    } else if (qrisString || paymentNumber) {
      const qrData = qrisString || paymentNumber;
      qrisUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrData)}&size=500&format=png`;
    }
    
    console.log(`Order Created: ${orderId} | User: ${username} | Cloudflare Verified`);
    
    res.json({
      success: true,
      orderId,
      amount,
      qrisUrl,
      paymentCode: paymentCode || null,
      qrisString: qrisString || paymentNumber || null,
      plan,
      username,
      email
    });
    
  } catch (err) {
    console.error('Payment creation error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server: ' + err.message 
    });
  }
});

app.post('/api/payment/check', async (req, res) => {
  try {
    const { orderId, amount, plan, username, email } = req.body;
    
    const url = `https://app.pakasir.com/api/transactiondetail?project=${CONFIG.pakasir.project}&amount=${amount}&order_id=${orderId}&api_key=${CONFIG.pakasir.apiKey}`;
    
    const detailRes = await fetch(url);
    const detail = await detailRes.json();
    const tx = detail.transaction || detail;
    const status = (tx.status || '').toString().toUpperCase();
    
    if (status.includes('SUCCESS') || status.includes('COMPLETED') || status.includes('BERHASIL')) {
      try {
        // Log pembayaran sukses
        addPaymentLog(orderId, amount, 'SUCCESS', { plan, username, email });
        
        const { user, password } = await createPteroUser(username);
        const server = await createPteroServer(user.id, username, plan);
        
        const telegramMsg = `🎉 <b>TRANSAKSI BARU BERHASIL</b>\n\n📦 <b>Order ID:</b> ${orderId}\n👤 <b>Username:</b> ${username}\n📧 <b>Email:</b> ${email}\n💰 <b>Plan:</b> ${plan.toUpperCase()}\n💵 <b>Amount:</b> Rp ${amount.toLocaleString('id-ID')}\n🆔 <b>Server ID:</b> ${server.id}\n🔑 <b>Token Garansi:</b> <code>${server.warrantyToken}</code>\n\n✅ Panel telah dikirim ke user`;
        
        await sendTelegramNotif(telegramMsg);
        
        return res.json({
          success: true,
          status: 'success',
          panel: {
            serverId: server.id,
            username: user.username,
            password,
            email: user.email,
            domain: CONFIG.pterodactyl.domain,
            warrantyToken: server.warrantyToken
          }
        });
        
      } catch (panelErr) {
        console.error('Panel creation error:', panelErr);
        addErrorLog(panelErr, { orderId, username, email });
        
        await sendTelegramLog('errors', `❌ <b>GAGAL BUAT SERVER</b>\n\n📦 <b>Order ID:</b> ${orderId}\n👤 <b>Username:</b> ${username}\n💵 <b>Amount:</b> Rp ${amount.toLocaleString('id-ID')}\n❌ <b>Error:</b> ${panelErr.message}\n\n⚠️ Pembayaran berhasil tapi gagal membuat panel`);
        
        return res.json({
          success: false,
          status: 'payment_success_panel_failed',
          message: 'Pembayaran berhasil tapi gagal membuat panel. Hubungi admin.'
        });
      }
    }
    
    if (status.includes('FAILED') || status.includes('EXPIRED') || status.includes('GAGAL')) {
      addPaymentLog(orderId, amount, 'FAILED');
      
      await sendTelegramLog('payments', `❌ <b>PEMBAYARAN GAGAL</b>\n\n📦 <b>Order ID:</b> ${orderId}\n💵 <b>Amount:</b> Rp ${amount.toLocaleString('id-ID')}\n❌ <b>Status:</b> ${status}`);
      
      return res.json({ success: true, status: 'failed' });
    }
    
    // Status pending
    addPaymentLog(orderId, amount, 'PENDING');
    
    res.json({ success: true, status: 'pending' });
    
  } catch (err) {
    console.error(err);
    addErrorLog(err, { endpoint: 'payment_check' });
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server' 
    });
  }
});

// ===== API GARANSI =====
app.post('/api/warranty/claim', async (req, res) => {
  try {
    const { serverId, token } = req.body;
    
    if (!serverId || !token) {
      return res.status(400).json({
        success: false,
        message: 'Server ID dan token wajib diisi'
      });
    }
    
    // Validasi token
    const validation = await validateWarrantyToken(token, serverId);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }
    
    // Proses klaim garansi
    addServerLog(serverId, 'WARRANTY_CLAIMED', { token, username: validation.username });
    
    res.json({
      success: true,
      message: 'Klaim garansi berhasil',
      details: 'Server akan di-reset dalam waktu 24 jam'
    });
    
  } catch (err) {
    console.error('Warranty claim error:', err);
    addErrorLog(err, { endpoint: 'warranty_claim' });
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

app.get('/api/warranty/check/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = db.warrantyTokens.get(token);
    
    if (!tokenData) {
      return res.json({
        success: false,
        valid: false,
        message: 'Token tidak ditemukan'
      });
    }
    
    const now = new Date();
    const expiresAt = new Date(tokenData.expiresAt);
    
    res.json({
      success: true,
      valid: !tokenData.used && now < expiresAt,
      used: tokenData.used,
      expired: now >= expiresAt,
      serverId: tokenData.serverId,
      username: tokenData.username,
      createdAt: tokenData.createdAt,
      expiresAt: tokenData.expiresAt,
      usedAt: tokenData.usedAt,
      daysRemaining: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
    });
    
  } catch (err) {
    console.error('Warranty check error:', err);
    addErrorLog(err, { endpoint: 'warranty_check' });
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

// ===== ADMIN API =====
app.get('/api/admin/products', requireAuth, (req, res) => {
  const products = Object.keys(CONFIG.prices).map(key => ({
    id: key,
    name: key.toUpperCase(),
    price: CONFIG.prices[key],
    specs: specs[key]
  }));
  
  res.json({ success: true, products });
});

app.post('/api/admin/products', requireAuth, async (req, res) => {
  try {
    let { id, price, ram, disk, cpu } = req.body;
    
    id = sanitizeInput(id);
    
    if (!id || price === undefined || ram === undefined || disk === undefined || cpu === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Semua field wajib diisi' 
      });
    }
    
    if (!/^[a-z0-9_-]+$/.test(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID hanya boleh huruf kecil, angka, - dan _' 
      });
    }
    
    if (CONFIG.prices[id]) {
      return res.status(400).json({ 
        success: false, 
        message: 'Product ID sudah ada' 
      });
    }
    
    price = parseInt(price);
    ram = parseInt(ram);
    disk = parseInt(disk);
    cpu = parseInt(cpu);
    
    if (isNaN(price) || isNaN(ram) || isNaN(disk) || isNaN(cpu)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Price, RAM, Disk, dan CPU harus berupa angka' 
      });
    }
    
    if (price < 0 || ram < 0 || disk < 0 || cpu < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nilai tidak boleh negatif (gunakan 0 untuk unlimited)' 
      });
    }
    
    CONFIG.prices[id] = price;
    specs[id] = { ram, disk, cpu };
    
    const telegramMsg = `🆕 <b>PRODUK BARU DITAMBAHKAN</b>\n\n🏷️ <b>ID:</b> ${id}\n💰 <b>Harga:</b> Rp ${price.toLocaleString('id-ID')}\n💾 <b>RAM:</b> ${ram === 0 ? 'Unlimited' : ram + ' MB'}\n📦 <b>Disk:</b> ${disk === 0 ? 'Unlimited' : disk + ' MB'}\n⚡ <b>CPU:</b> ${cpu === 0 ? 'Unlimited' : cpu + '%'}\n\n👤 <b>Oleh:</b> ${req.session.adminUsername}`;
    
    await sendTelegramNotif(telegramMsg);
    
    res.json({ 
      success: true, 
      message: 'Product berhasil ditambahkan',
      product: { id, price, specs: specs[id] }
    });
    
  } catch (err) {
    console.error('Add product error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server' 
    });
  }
});

app.put('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let { price, ram, disk, cpu } = req.body;
    
    if (!CONFIG.prices[id]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product tidak ditemukan' 
      });
    }
    
    if (price === undefined || ram === undefined || disk === undefined || cpu === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Semua field wajib diisi' 
      });
    }
    
    price = parseInt(price);
    ram = parseInt(ram);
    disk = parseInt(disk);
    cpu = parseInt(cpu);
    
    if (isNaN(price) || isNaN(ram) || isNaN(disk) || isNaN(cpu)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Price, RAM, Disk, dan CPU harus berupa angka' 
      });
    }
    
    if (price < 0 || ram < 0 || disk < 0 || cpu < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nilai tidak boleh negatif (gunakan 0 untuk unlimited)' 
      });
    }
    
    const oldData = {
      price: CONFIG.prices[id],
      specs: {...specs[id]}
    };
    
    CONFIG.prices[id] = price;
    specs[id] = { ram, disk, cpu };
    
    const telegramMsg = `✏️ <b>PRODUK DIUPDATE</b>\n\n🏷️ <b>ID:</b> ${id}\n\n<b>Harga:</b>\n❌ Lama: Rp ${oldData.price.toLocaleString('id-ID')}\n✅ Baru: Rp ${price.toLocaleString('id-ID')}\n\n<b>Spek:</b>\n💾 RAM: ${oldData.specs.ram} MB → ${ram} MB\n📦 Disk: ${oldData.specs.disk} MB → ${disk} MB\n⚡ CPU: ${oldData.specs.cpu}% → ${cpu}%\n\n👤 <b>Oleh:</b> ${req.session.adminUsername}`;
    
    await sendTelegramNotif(telegramMsg);
    
    res.json({ 
      success: true, 
      message: 'Product berhasil diupdate',
      product: { id, price, specs: specs[id] }
    });
    
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server' 
    });
  }
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    
    if (!CONFIG.prices[id]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product tidak ditemukan' 
      });
    }
    
    const deletedData = {
      price: CONFIG.prices[id],
      specs: {...specs[id]}
    };
    
    delete CONFIG.prices[id];
    delete specs[id];
    
    const telegramMsg = `🗑️ <b>PRODUK DIHAPUS</b>\n\n🏷️ <b>ID:</b> ${id}\n💰 <b>Harga:</b> Rp ${deletedData.price.toLocaleString('id-ID')}\n💾 <b>RAM:</b> ${deletedData.specs.ram} MB\n📦 <b>Disk:</b> ${deletedData.specs.disk} MB\n⚡ <b>CPU:</b> ${deletedData.specs.cpu}%\n\n👤 <b>Oleh:</b> ${req.session.adminUsername}`;
    
    await sendTelegramNotif(telegramMsg);
    
    res.json({ 
      success: true, 
      message: 'Product berhasil dihapus'
    });
    
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server' 
    });
  }
});

app.get('/api/admin/stats', requireAuth, (req, res) => {
  const totalProducts = Object.keys(CONFIG.prices).length;
  const totalRevenue = Object.values(CONFIG.prices).reduce((sum, price) => sum + price, 0);
  const avgPrice = totalProducts > 0 ? totalRevenue / totalProducts : 0;
  
  res.json({
    success: true,
    stats: {
      totalProducts,
      totalRevenue,
      avgPrice: Math.round(avgPrice),
      cheapestProduct: totalProducts > 0 ? Math.min(...Object.values(CONFIG.prices)) : 0,
      mostExpensive: totalProducts > 0 ? Math.max(...Object.values(CONFIG.prices)) : 0
    }
  });
});

// === ADMIN LOGS API ===
app.get('/api/admin/logs/servers', requireAuth, (req, res) => {
  try {
    const logs = [];
    db.serverLogs.forEach((serverLogs, serverId) => {
      logs.push({
        serverId,
        logs: serverLogs.slice(-50) // Ambil 50 log terakhir
      });
    });
    
    res.json({
      success: true,
      totalServers: db.serverLogs.size,
      logs
    });
  } catch (err) {
    console.error('Get server logs error:', err);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

app.get('/api/admin/logs/payments', requireAuth, (req, res) => {
  try {
    res.json({
      success: true,
      total: db.paymentLogs.length,
      logs: db.paymentLogs.slice(-100).reverse() // 100 log terbaru
    });
  } catch (err) {
    console.error('Get payment logs error:', err);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

app.get('/api/admin/logs/errors', requireAuth, (req, res) => {
  try {
    res.json({
      success: true,
      total: db.errorLogs.length,
      logs: db.errorLogs.slice(-50).reverse() // 50 error terbaru
    });
  } catch (err) {
    console.error('Get error logs error:', err);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

app.get('/api/admin/warranty/tokens', requireAuth, (req, res) => {
  try {
    const tokens = [];
    db.warrantyTokens.forEach((tokenData, token) => {
      tokens.push({
        token,
        ...tokenData
      });
    });
    
    res.json({
      success: true,
      total: tokens.length,
      active: tokens.filter(t => !t.used && new Date() < t.expiresAt).length,
      used: tokens.filter(t => t.used).length,
      expired: tokens.filter(t => new Date() >= t.expiresAt).length,
      tokens
    });
  } catch (err) {
    console.error('Get warranty tokens error:', err);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

// ===== UTILITY API =====
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running',
    features: {
      warranty: CONFIG.warranty.enabled,
      telegramLogs: CONFIG.telegram.logChannels ? true : false,
      admin: true
    }
  });
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Log error ke database dan Telegram
  addErrorLog(err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  sendTelegramLog('errors', `🔥 <b>SERVER ERROR</b>\n\n📄 <b>Endpoint:</b> ${req.method} ${req.url}\n❌ <b>Error:</b> ${err.message}\n🕒 <b>Waktu:</b> ${new Date().toLocaleTimeString('id-ID')}`);
  
  res.status(500).json({ 
    success: false, 
    message: 'Terjadi kesalahan server' 
  });
});

app.use((req, res) => {
  res.status(404).send('404 - Not Found');
});

// ===== SERVER START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔒 Security: Helmet + Rate Limiting enabled`);
  console.log(`🛡️ Warranty System: ${CONFIG.warranty.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`🤖 Telegram Logs: ${CONFIG.telegram.logChannels ? 'Enabled' : 'Disabled'}`);
  console.log(`👤 Admin: http://localhost:${PORT}/admin/login`);
  console.log(`📝 Username: ${CONFIG.admin.username} | Password: ${CONFIG.admin.password}`);
  console.log(`🛡️ Warranty Page: http://localhost:${PORT}/warranty`);
});
