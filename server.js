try { require('dotenv').config(); } catch (e) {}

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3005;

// CONFIG
const SPREADSHEET_ID = (process.env.SPREADSHEET_ID || '1ssGOSUFp0TK478tcPej1sWyg_dySw6oW').trim();
const REPARTIDOR_PHONE = '51916982923@s.whatsapp.net';
const VERCEL_CATALOG_URL = 'https://carta-cocoricco.vercel.app';
const GROQ_API_KEY = (process.env.GROQ_API_KEY || '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').trim();

let cachedProducts = [];
let lastSyncTime = null;
const conversationHistory = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let qrCodeDataUrl = null;
let connectionStatus = 'Iniciando conexión...';
let connectedNumber = null;
let sock = null;

// Auth & Data Dirs
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));

// -------------------------------------------------------------
// GOOGLE SHEETS LIVE SYNC
// -------------------------------------------------------------
function fetchGoogleSheetTab(tabName) {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const jsonStr = body.replace(/^[^{]*\{/, '{').replace(/\}[^}]*$/, '}');
          const parsed = JSON.parse(jsonStr);
          const cols = parsed.table.cols.map(c => c.label || c.id);
          const rows = parsed.table.rows.map(r => {
            const rowObj = {};
            r.c.forEach((cell, idx) => {
              const colName = cols[idx];
              if (colName) {
                rowObj[colName] = cell ? (cell.f || cell.v) : '';
              }
            });
            return rowObj;
          });
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function syncProductsFromGoogleSheets() {
  try {
    const rows = await fetchGoogleSheetTab('PRODUCTOS_STOCK');
    if (rows && rows.length > 0) {
      cachedProducts = rows;
      lastSyncTime = new Date().toLocaleTimeString();
      console.log(`[Google Sheets] ✓ ${rows.length} productos sincronizados (${lastSyncTime})`);
    }
  } catch (err) {
    console.error('[Google Sheets Error]:', err.message);
  }
}

syncProductsFromGoogleSheets();
setInterval(syncProductsFromGoogleSheets, 30000);

function getProductStock(p) {
  const raw = p['Stock Disponible'] || p.Stock_Disponible || p.Stock_Actual || p.Stock || 0;
  return Number(raw) || 0;
}

function isProductAvailable(p) {
  const status = (p.Estado_Stock || p.Estado || 'Disponible').toString().toLowerCase();
  const stock = getProductStock(p);
  return !status.includes('agotado') && stock > 0;
}

// -------------------------------------------------------------
// MOTOR IA GENERATIVA PERSUASIVA (BREVE, DIRECTA Y VENTAS RÁPIDAS)
// -------------------------------------------------------------
function buildSystemPrompt() {
  const stockSummary = cachedProducts
    .filter(p => !(p.Nombre_Producto || '').toLowerCase().includes('copa'))
    .map(p => {
      const stock = getProductStock(p);
      const avail = isProductAvailable(p);
      return `• ${p.Nombre_Producto} (${p.Medida_Detalle}): S/. ${p.Precio_Soles} | Stock: ${avail ? stock + ' disponibles' : 'AGOTADO'}`;
    }).join('\n');

  return `Eres el Asesor Estrella de Ventas de "Coco Ricco" (Fresas con Crema & Helados Artesanales) en Jaén, Perú.

DIRECTIVAS CRÍTICAS DE COMUNICACIÓN (VENTAS RÁPIDAS):
1. RESPUESTAS BREVES Y PRECISAS: Responde en MÁXIMO 2 a 3 líneas cortas y atractivas. Sé directo, sin rodeos ni textos largos.
2. ALTAMENTE PERSUASIVO: Tu objetivo es cerrar la venta lo antes posible con energía alegre y antojable.
3. RECOMIENDA EL CATÁLOGO DESDE EL INICIO: En saludos o consultas iniciales, envía de inmediato el enlace con fotos: 👉 ${VERCEL_CATALOG_URL}
4. PRECIOS Y PRODUCTOS DISPONIBLES:
   - Vasitos de Fresas con Crema artesanal y toppings: 5oz (S/5), 8oz (S/8 ⭐ el más pedido), 10oz (S/10), 12oz Mega (S/12).
   - Helado en Tazón de Coco Natural: S/. 12.00 (servido en cáscara real de coco 🥥).
   - Paletas Artesanales: S/. 6.00 (Coco, Lúcuma, Arándano, Oreo, Mango — Con Leche Nestlé adentro o Pura Fruta sin lácteos).
   *(NOTA: NO vendemos helado en copa de 2 bolas, solo tazón de coco y paletas).*
5. CIERRE DE VENTA DIRECTO: Invita a pedir con preguntas de cierre: "¿A qué dirección en Jaén te lo enviamos hoy?" o "¿Cuál se te antoja que te preparemos?".
6. DATOS DE PAGO: Yape/Plin al 938 955 940 (Coco Ricco) o Efectivo contra entrega. Delivery rápido en Jaén (20 a 30 min).

STOCK ACTUAL:
${stockSummary || 'Stock disponible en fresas, tazones de coco y paletas'}`;
}

async function callGroqAi(prompt, userHistory) {
  if (!GROQ_API_KEY) return null;

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...userHistory,
    { role: 'user', content: prompt }
  ];

  const payload = JSON.stringify({
    model: 'groq/compound-mini',
    messages: messages,
    temperature: 0.65,
    max_tokens: 180 // Respuestas breves y precisas
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.groq.com',
        port: 443,
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const text = parsed.choices?.[0]?.message?.content;
            resolve(text || null);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// -------------------------------------------------------------
// RESPUESTA CONVERSACIONAL RÁPIDA
// -------------------------------------------------------------
async function getConversationalReply(from, text) {
  const cleanPhone = from.replace(/[^0-9]/g, '');

  if (!conversationHistory[cleanPhone]) conversationHistory[cleanPhone] = [];
  
  const aiReply = await callGroqAi(text, conversationHistory[cleanPhone]);
  if (aiReply) {
    conversationHistory[cleanPhone].push({ role: 'user', content: text });
    conversationHistory[cleanPhone].push({ role: 'assistant', content: aiReply });
    if (conversationHistory[cleanPhone].length > 8) {
      conversationHistory[cleanPhone] = conversationHistory[cleanPhone].slice(-8);
    }
    return aiReply;
  }

  // Respaldo Breve y Persuasivo
  return `¡Hola! 👋🍓 ¡Qué rico tenerte por aquí! Mira todas nuestras fotos y precios al instante en nuestra carta: 👉 ${VERCEL_CATALOG_URL}\n\n¿A qué dirección en Jaén te enviamos tu pedido hoy? 🛵🥥`;
}

// -------------------------------------------------------------
// WHATSAPP BAILEYS CONNECTION
// -------------------------------------------------------------
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['Coco Ricco Sales AI', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'Esperando escaneo de Código QR...';
      try {
        qrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
      } catch (err) {
        console.error('Error generando QR:', err);
      }
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'Conexión cerrada. Reconectando...';
      qrCodeDataUrl = null;
      connectedNumber = null;

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      } else {
        connectionStatus = 'Sesión cerrada. Escanea un nuevo código QR.';
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connectToWhatsApp, 2000);
      }
    } else if (connection === 'open') {
      connectionStatus = '✓ CONECTADO 24/7 A WHATSAPP';
      qrCodeDataUrl = null;
      connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Activo';
      console.log('✓ Bot de Coco Ricco (IA Ventas Persuasivas) conectado exitosamente!');
    }
  });

  // Message Handler
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      if (from.endsWith('@g.us')) continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      const hasImage = !!msg.message.imageMessage;
      if (!text && !hasImage) continue;

      console.log(`[WhatsApp Inbound de ${from}]: "${text}"`);

      // Motorizado (916982923)
      if (from.includes('916982923') || from === REPARTIDOR_PHONE) {
        if (text.toLowerCase().includes('entregado')) {
          const matchId = text.match(/PED-\d+/i);
          const orderCode = matchId ? matchId[0].toUpperCase() : 'Último Pedido';
          
          await sock.sendMessage(from, {
            text: `✅ *¡RECIBIDO!* El pedido *#${orderCode}* ha sido marcado como *ENTREGADO* en el sistema de Coco Ricco. 🛵👏`
          });
          return;
        }
      }

      // Procesa con IA Persuasiva Breve
      const aiReply = await getConversationalReply(from, text);
      if (aiReply) {
        await sock.sendMessage(from, { text: aiReply });
      }
    }
  });
}

connectToWhatsApp().catch(console.error);

// -------------------------------------------------------------
// WEB API ROUTES
// -------------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qrCode: qrCodeDataUrl,
    connectedNumber: connectedNumber,
    isReady: connectionStatus.includes('CONECTADO'),
    aiEngine: 'Groq Persuasive Sales AI'
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK - Coco Ricco AI Gateway 24/7');
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍓 COCO RICCO BOT 24/7 — IA DE VENTAS PERSUASIVAS ACTIVA`);
  console.log(`PUERTO: ${PORT}`);
  console.log(`====================================================`);
});
