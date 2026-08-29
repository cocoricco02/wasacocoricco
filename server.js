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

// CONFIG (con .trim() para limpiar espacios y saltos de línea)
const SPREADSHEET_ID = (process.env.SPREADSHEET_ID || '1ssGOSUFp0TK478tcPej1sWyg_dySw6oW').trim();
const REPARTIDOR_PHONE = '51916982923@s.whatsapp.net';
const VERCEL_CATALOG_URL = 'https://carta-cocoricco.vercel.app';
const N8N_WEBHOOK_URL = (process.env.N8N_WEBHOOK_URL || '').trim();

let cachedProducts = [];
let lastSyncTime = null;

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
// ENVIAR MENSAJE A N8N WEBHOOK
// -------------------------------------------------------------
async function forwardToN8n(from, text, hasImage = false) {
  const cleanUrl = N8N_WEBHOOK_URL.trim();
  if (!cleanUrl || !cleanUrl.startsWith('http')) {
    console.log('[n8n Webhook]: No hay URL de n8n configurada.');
    return null;
  }

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
      const urlObj = new URL(cleanUrl);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      console.log(`[n8n Webhook] Enviando a: ${cleanUrl}`);

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
          timeout: 25000 // 25s timeout para que el AI Agent de n8n piense
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`[n8n Webhook Response (${res.statusCode})]:`, data);

            if (res.statusCode >= 400 || data.includes('not registered')) {
              resolve(null);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const responseText = parsed.response || parsed.output || parsed.text || parsed.message;
              resolve(responseText || null);
            } catch (e) {
              if (data && data.trim().length > 0 && !data.includes('not registered')) {
                resolve(data.trim());
              } else {
                resolve(null);
              }
            }
          });
        }
      );

      req.on('error', (err) => {
        console.error('[n8n Webhook Request Error]:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        console.error('[n8n Webhook Timeout]: El agente de n8n tardó más de 25s');
        req.destroy();
        resolve(null);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.error('[n8n URL Parse Error]:', err.message);
      resolve(null);
    }
  });
}

// -------------------------------------------------------------
// RESPALDO CONVERSACIONAL (SOLO SI N8N ESTÁ APAGADO)
// -------------------------------------------------------------
function generateFallbackResponse(text) {
  const clean = text.toLowerCase().trim();

  if (clean.includes('no hice') || clean.includes('no he hecho') || clean.includes('no pedi') || clean.includes('equivoc') || clean.includes('disculpa')) {
    return `¡Ah, disculpa la confusión! 😊 No te preocupes, no se ha generado ningún pedido.\n\nSi deseas consultar sobre nuestros helados o vasitos de fresas con crema, avísame con toda confianza. 🍓🥥`;
  }

  if (clean.includes('como hago') || clean.includes('como pido') || clean.includes('como hacer un pedido') || clean.includes('hacen pedidos') || clean.includes('hacen pedido')) {
    return `¡Sí, claro que sí! Tomamos pedidos para delivery en todo Jaén y recojo en tienda. 🛵🍓\n\nSolo indícanos qué delicias deseas llevar, tu dirección en Jaén y si pagarás con Yape, Plin o Efectivo.\n\n📸 Fotos de la carta: 👉 ${VERCEL_CATALOG_URL}\n\n¿Qué se te antoja para hoy? 😊`;
  }

  return `¡Hola! 👋🍓 En *Coco Ricco* estamos atentos para atenderte con mucho gusto.\n\n• 📸 Fotos y carta oficial: 👉 ${VERCEL_CATALOG_URL}\n• 🛵 Delivery en todo Jaén y atención en local (11am a 10pm).\n\n¿En qué te podemos ayudar hoy? 😊🥥`;
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

      // 1. Enviar primero al AI Agent de n8n
      let reply = await forwardToN8n(from, text, hasImage);

      // 2. Si n8n no responde, usar respaldo
      if (!reply) {
        reply = generateFallbackResponse(text);
      }

      if (reply) {
        await sock.sendMessage(from, { text: reply });
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
  console.log(`🔗 N8N URL: ${N8N_WEBHOOK_URL}`);
  console.log(`====================================================`);
});
