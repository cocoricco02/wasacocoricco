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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1ssGOSUFp0TK478tcPej1sWyg_dySw6oW';
const REPARTIDOR_PHONE = '51916982923@s.whatsapp.net';
const VERCEL_CATALOG_URL = 'https://carta-cocoricco.vercel.app';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/whatsapp-inbound';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

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

// -------------------------------------------------------------
// ENVIAR MENSAJE A N8N WEBHOOK
// -------------------------------------------------------------
async function forwardToN8n(from, text, hasImage = false) {
  const cleanPhone = from.replace(/[^0-9]/g, '');
  const payload = JSON.stringify({
    phone: cleanPhone,
    from: from,
    message: text,
    text: text,
    hasImage: hasImage,
    timestamp: new Date().toISOString()
  });

  return new Promise((resolve) => {
    try {
      const urlObj = new URL(N8N_WEBHOOK_URL);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 10000
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const responseText = parsed.response || parsed.output || parsed.text || parsed.message;
              resolve(responseText || null);
            } catch (e) {
              resolve(data && data.length > 5 ? data : null);
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      resolve(null);
    }
  });
}

// -------------------------------------------------------------
// LLAMADA DIRECTA A OPENAI (REST API NATIVA SIN DEPENDENCIAS)
// -------------------------------------------------------------
async function callOpenAiNative(prompt, history) {
  if (!OPENAI_API_KEY) return null;

  const messages = [
    {
      role: 'system',
      content: `Eres el Asesor Virtual Oficial de 'Coco Ricco' (Heladería Artesanal & Fresas con Crema) en Jaén, Cajamarca, Perú.
Tu tono es 100% humano, alegre, cálido, empático y servicial. Usa emojis (🍓, 🥥, 🍦, 😊, 🛵).
NUNCA respondas con respuestas robóticas o pedidos falsos.
Carta Virtual Oficial: ${VERCEL_CATALOG_URL}
Pagos: Yape / Plin al 938 955 940 (Coco Ricco) o Efectivo en Jaén.
Horario: 11:00 AM a 10:00 PM.
Productos: Vasos de fresas con crema (5oz S/5, 8oz S/8, 10oz S/10, 12oz S/12), Helado en Tazón de Coco Natural S/12, Helado Copa S/8, Paletas artesanales S/6 (con/sin leche Nestlé).`
    },
    ...history
  ];

  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: messages,
    temperature: 0.7,
    max_tokens: 300
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.choices?.[0]?.message?.content || null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// -------------------------------------------------------------
// MOTOR CONVERSACIONAL INTELIGENTE
// -------------------------------------------------------------
async function generateConversationalResponse(from, text) {
  const cleanPhone = from.replace(/[^0-9]/g, '');

  // 1. Intentar primero con el Agente de n8n
  const n8nReply = await forwardToN8n(from, text);
  if (n8nReply) {
    console.log(`[n8n AI Response]: "${n8nReply}"`);
    return n8nReply;
  }

  // 2. Intentar con OpenAI si la clave está configurada
  if (OPENAI_API_KEY) {
    if (!conversationHistory[cleanPhone]) conversationHistory[cleanPhone] = [];
    conversationHistory[cleanPhone].push({ role: 'user', content: text });
    if (conversationHistory[cleanPhone].length > 8) conversationHistory[cleanPhone] = conversationHistory[cleanPhone].slice(-8);

    const openaiReply = await callOpenAiNative(text, conversationHistory[cleanPhone]);
    if (openaiReply) {
      conversationHistory[cleanPhone].push({ role: 'assistant', content: openaiReply });
      return openaiReply;
    }
  }

  // 3. Motor Conversacional Humano (Cero plantillas fijas de error)
  const clean = text.toLowerCase().trim();

  if (clean.includes('no hice') || clean.includes('no he hecho') || clean.includes('no pedi') || clean.includes('equivoc') || clean.includes('disculpa')) {
    return `¡Ah, disculpa la confusión! 😊 No te preocupes para nada, no se ha generado ningún pedido ni cobro.\n\nSi en algún momento deseas probar alguna de nuestras fresas con crema o helados en coco, avísame con toda confianza. 🍓🥥`;
  }

  if (clean.includes('como hago') || clean.includes('como pido') || clean.includes('como hacer un pedido') || clean.includes('quiero saber como pedir')) {
    return `¡Es súper fácil! 😊 Solo indícanos por aquí:\n1. Qué vasitos, helados o paletas deseas llevar.\n2. Si es para delivery (indícanos tu dirección en Jaén) o recojo en nuestro local.\n3. Si pagarás con Yape, Plin o Efectivo.\n\n📸 Puedes ver fotos de todo en nuestra carta: 👉 ${VERCEL_CATALOG_URL}\n\n¿Qué se te antoja para hoy? 🍓🥥`;
  }

  if (clean.includes('que venden') || clean.includes('que tienen') || clean.includes('que ofrecen') || clean.includes('venden helados') || clean.includes('carta') || clean.includes('fotos') || clean.includes('catalogo')) {
    return `¡Hola! Qué gusto saludarte. En *Coco Ricco* preparamos delicias 100% artesanales y naturales: 🍓🥥\n\n• *Fresas con Crema:* Vasitos de 5oz (S/5), 8oz (S/8), 10oz (S/10) y 12oz (S/12) con crema de la casa y toppings deliciosos.\n• *Helados en Tazón de Coco Natural:* En coco real a S/. 12.00.\n• *Helado en Copa:* 2 bolas de pura fruta a S/. 8.00.\n• *Paletas Artesanales:* A S/. 6.00 (rellenas con Leche Nestlé o 100% Pura Fruta).\n\n📸 *Mira fotos reales en nuestra Carta Virtual:* 👉 ${VERCEL_CATALOG_URL}\n\n¿Te gustaría que te preparemos algo rico? 😊`;
  }

  return `¡Hola! 👋🍓 En *Coco Ricco* estamos atentos para atenderte con mucho gusto.\n\n• 📸 Fotos y productos: 👉 ${VERCEL_CATALOG_URL}\n• 🛵 Delivery en todo Jaén y atención en local (11am a 10pm).\n\n¿Tienes alguna duda o te gustaría hacer un pedido? Cuéntame con confianza. 😊🥥`;
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
      connectionStatus = '✓ CONECTADO 24/7 A WHATSAPP';
      qrCodeDataUrl = null;
      connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Activo';
      console.log('✓ Bot de Coco Ricco conectado exitosamente a WhatsApp!');
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

      console.log(`[Mensaje Recibido de ${from}]: "${text}"`);

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

      const aiReply = await generateConversationalResponse(from, text);
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
    n8nWebhookUrl: N8N_WEBHOOK_URL,
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
  console.log(`🍓 COCO RICCO BOT 24/7 — GATEWAY DE IA DEFINITIVO ACTIVO`);
  console.log(`PUERTO: ${PORT}`);
  console.log(`====================================================`);
});
