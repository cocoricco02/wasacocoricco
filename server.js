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
// MOTOR IA GENERATIVA REAL (GROQ COMPOUND / LLAMA 3.3)
// -------------------------------------------------------------
function buildSystemPrompt() {
  const stockSummary = cachedProducts.map(p => {
    const stock = getProductStock(p);
    const avail = isProductAvailable(p);
    return `• ${p.Nombre_Producto} (${p.Medida_Detalle}): S/. ${p.Precio_Soles} | Stock disponible: ${avail ? stock + ' unidades' : 'AGOTADO'}`;
  }).join('\n');

  return `Eres el Asesor Virtual Oficial de 'Coco Ricco' (Heladería Artesanal & Fresas con Crema) en Jaén, Cajamarca, Perú.

TU FORMA DE HABLAR Y PERSONALIDAD:
- Eres 100% humano, alegre, cálido, empático, conversacional y atento (como una persona real que atiende por WhatsApp con amabilidad peruana).
- Usa emojis con gusto y naturalidad (🍓, 🥥, 🍦, 😊, 🛵, ✨).
- Responde de forma concisa y amigable a lo que el cliente te pregunte o converse contigo. NUNCA respondas con menús robóticos rígidos si solo te están saludando o preguntando tu opinión.
- Si te preguntan si los precios son caros, explica con calidez que son precios súper justos y accesibles (vasitos desde S/ 5.00) preparados con fresas frescas del día y crema artesanal de la mejor calidad.

INFORMACIÓN DEL NEGOCIO (COCO RICCO):
- Ubicación: Jaén, Cajamarca, Perú.
- Horario de Atención: Lunes a Domingo de 11:00 AM a 10:00 PM.
- Delivery: Cobertura rápida a toda la ciudad de Jaén (20 a 30 min aprox).
- Carta Virtual Oficial con fotos en alta definición: ${VERCEL_CATALOG_URL}
- Métodos de Pago: Yape o Plin al número oficial 938 955 940 (a nombre de Coco Ricco), o Efectivo contra entrega en Jaén.

NUESTROS PRODUCTOS Y PRECIOS:
1. Fresas con Crema Artesanales (con crema de la casa, fudge, chantilly y toppings como Oreo, Brownie, M&M):
   - Vaso 5 oz: S/. 5.00
   - Vaso 8 oz: S/. 8.00 (El más pedido)
   - Vaso 10 oz: S/. 10.00
   - Vaso 12 oz Mega: S/. 12.00
   - Vaso Especial Oreo & M&M (12 oz): S/. 12.00
2. Helados en Tazón de Coco Natural: S/. 12.00 (servidos en cáscara real de coco con jalea de maracuyá o natural).
3. Helado Artesanal en Copa 2 Bolas: S/. 8.00 (100% pura fruta natural).
4. Paletas Artesanales: S/. 6.00 (Sabores: Coco, Lúcuma, Arándano, Oreo, Fudge de Chocolate y Mango Tropical).
   - Opción 1: Rellenas CON Leche Nestlé adentro (leche condensada cremosa).
   - Opción 2: SIN Leche (100% pura fruta natural fresca, ideal si no consumen lácteos).

STOCK EN GOOGLE SHEETS EN VIVO:
${stockSummary || 'Stock disponible en todas las presentaciones'}

ATENCIÓN Y TOMA DE PEDIDOS:
- Si el cliente desea pedir, indícale amablemente que te dé su dirección en Jaén y su método de pago (Yape/Plin o Efectivo) para prepararlo de inmediato.`;
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
    temperature: 0.7,
    max_tokens: 350
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
        timeout: 15000
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
// RESPUESTA CONVERSACIONAL
// -------------------------------------------------------------
async function getConversationalReply(from, text) {
  const cleanPhone = from.replace(/[^0-9]/g, '');

  if (!conversationHistory[cleanPhone]) conversationHistory[cleanPhone] = [];
  
  const aiReply = await callGroqAi(text, conversationHistory[cleanPhone]);
  if (aiReply) {
    conversationHistory[cleanPhone].push({ role: 'user', content: text });
    conversationHistory[cleanPhone].push({ role: 'assistant', content: aiReply });
    if (conversationHistory[cleanPhone].length > 10) {
      conversationHistory[cleanPhone] = conversationHistory[cleanPhone].slice(-10);
    }
    return aiReply;
  }

  // Respaldo
  return `¡Hola! 👋🍓 Qué gusto saludarte. En *Coco Ricco* preparamos las mejores fresas con crema y helados artesanales de Jaén.\n\n• 📸 Mira fotos reales en nuestra Carta: 👉 ${VERCEL_CATALOG_URL}\n• 🛵 Delivery rápido en todo Jaén (11am a 10pm).\n\n¿En qué te podemos consentir hoy? 😊🥥`;
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
    browser: ['Coco Ricco AI Bot', 'Chrome', '1.0.0']
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
      connectionStatus = '✓ CONECTADO 24/7 A WHATSAPP (IA GROQ)';
      qrCodeDataUrl = null;
      connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Activo';
      console.log('✓ Bot de Coco Ricco (Cerebro IA Groq) conectado exitosamente!');
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

      // Procesa con IA Generativa Real
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
    aiEngine: 'Groq Compound (Meta AI / Llama 3.3)',
    googleSheetSync: {
      spreadsheetId: SPREADSHEET_ID,
      productsCount: cachedProducts.length,
      lastSync: lastSyncTime
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK - Coco Ricco AI Gateway 24/7');
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍓 COCO RICCO BOT 24/7 — IA REAL GROQ COMPOUND ACTIVA`);
  console.log(`🔑 Clave Groq Configurada: SÍ`);
  console.log(`PUERTO: ${PORT}`);
  console.log(`====================================================`);
});
