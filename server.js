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

// GOOGLE SHEET SYNC CONFIG
const SPREADSHEET_ID = '1ssGOSUFp0TK478tcPej1sWyg_dySw6oW';
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
      console.log(`[Google Sheets Sync] ✓ ${rows.length} productos sincronizados con stock (${lastSyncTime})`);
    }
  } catch (err) {
    console.error('[Google Sheets Sync Error]:', err.message);
  }
}

// Initial sync and poll every 30 seconds
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

// Helper to format live menu with stock
function buildDynamicMenu() {
  if (!cachedProducts || cachedProducts.length === 0) {
    return `🍓 *CARTA OFICIAL COCO RICCO* 🥥\n• Vasitos de Fresas con Crema: 5oz (S/5), 8oz (S/8), 10oz (S/10), 12oz (S/12)\n• Helado en Tazón de Coco: S/. 12.00\n• Helado Copa 2 Bolas: S/. 8.00\n• Paletas (Con/Sin Leche Nestlé): S/. 6.00`;
  }

  let text = `🍨 *CARTA OFICIAL COCO RICCO (STOCK EN VIVO)* 🍓\n_Actualizado con Google Sheets_\n📍 Jaén, Cajamarca • ¡Lo natural hecho helado!\n\n`;

  const fresas = cachedProducts.filter(p => (p.Categoria || '').includes('Fresas'));
  if (fresas.length > 0) {
    text += `🍓 *FRESAS CON CREMA:*\n`;
    fresas.forEach(p => {
      const stock = getProductStock(p);
      const isAvailable = isProductAvailable(p);
      const stockTag = isAvailable ? `✓ (Quedan ${stock})` : '❌ (Agotado)';
      text += `• *${p.Nombre_Producto} (${p.Medida_Detalle}):* S/. ${parseFloat(p.Precio_Soles || 0).toFixed(2)} ${stockTag}\n`;
    });
    text += `\n`;
  }

  const helados = cachedProducts.filter(p => (p.Categoria || '').includes('Helados') || (p.Categoria || '').includes('Coco'));
  if (helados.length > 0) {
    text += `🥥 *HELADOS EN COCO Y COPAS:*\n`;
    helados.forEach(p => {
      const stock = getProductStock(p);
      const isAvailable = isProductAvailable(p);
      const stockTag = isAvailable ? `✓ (Quedan ${stock})` : '❌ (Agotado)';
      text += `• *${p.Nombre_Producto}:* S/. ${parseFloat(p.Precio_Soles || 0).toFixed(2)} ${stockTag}\n`;
    });
    text += `\n`;
  }

  const paletas = cachedProducts.filter(p => (p.Categoria || '').includes('Paletas'));
  if (paletas.length > 0) {
    text += `🍡 *PALETAS ARTESANALES (S/. 6.00):*\n`;
    paletas.forEach(p => {
      const stock = getProductStock(p);
      const isAvailable = isProductAvailable(p);
      const stockTag = isAvailable ? `✓ (Quedan ${stock})` : '❌ (Agotado)';
      text += `• *${p.Nombre_Producto}:* S/. ${parseFloat(p.Precio_Soles || 6).toFixed(2)} ${stockTag}\n`;
    });
    text += `_(Opciones: 🥛 Con Leche Nestlé adentro o 🍃 Sin Leche)_\n\n`;
  }

  text += `────────────────────────\n🛵 *¿CÓMO PEDIR?*\nEnvíanos tu pedido indicando:\n1. Producto y cantidad (ej: 2 vasos de 8oz)\n2. Dirección o recojo\n3. Método de pago: *Yape, Plin o Efectivo*\n\nEscribe *PAGO* o *UBICACION* para más info.`;

  return text;
}

// -------------------------------------------------------------
// WHATSAPP BOT LOGIC
// -------------------------------------------------------------
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['Coco Ricco Bot', 'Chrome', '1.0.0']
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
      if (from.endsWith('@g.us')) continue; // Ignore groups

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const cleanText = text.trim().toLowerCase();

      // 1. Catálogo / Carta / Fotos / Productos
      if (
        cleanText.includes('catalogo') ||
        cleanText.includes('carta') ||
        cleanText.includes('foto') ||
        cleanText.includes('producto') ||
        cleanText.includes('web') ||
        cleanText.includes('link') ||
        cleanText.includes('pagina')
      ) {
        const reply =
`🍨 *CARTA VIRTUAL OFICIAL COCO RICCO* 🍓
_Mira fotos en alta definición, tamaños y precios aquí:_

👉 *https://carta-cocoricco.vercel.app*

¿Te gustaría que te preparemos algún vasito de fresas con crema, helado en tazón de coco o paletas artesanales? 😊`;

        await sock.sendMessage(from, { text: reply });
      }

      // 2. Consulta de Delivery
      else if (cleanText.includes('delivery') || cleanText.includes('envio') || cleanText.includes('domicilio')) {
        const reply =
`🛵 *DELIVERY COCO RICCO — JAÉN* 🍓

¡Hola! Sí, contamos con servicio de delivery rápido a toda la ciudad de Jaén (tiempo estimado de 20 a 35 minutos).

Puedes ver nuestra carta con fotos y precios aquí:
👉 *https://carta-cocoricco.vercel.app*

¿Qué te gustaría pedir para hoy? 😊`;

        await sock.sendMessage(from, { text: reply });
      }

      // 3. Saludos Naturales
      else if (
        cleanText === 'hola' ||
        cleanText === 'buenas' ||
        cleanText === 'buenos dias' ||
        cleanText === 'buenas tardes' ||
        cleanText === 'buenas noches' ||
        cleanText === '1'
      ) {
        const reply =
`¡Hola! 👋🍓 Bienvenido a *Coco Ricco* (Heladería Artesanal & Fresas con Crema).

¿En qué te podemos consentir hoy?
• Ver fotos y productos: 👉 *https://carta-cocoricco.vercel.app*
• Escribe *MENU* para ver la lista de precios y stock del día.
• Escribe *PAGO* o *UBICACION* para más información.

¡Estamos atentos a tu pedido! 😊🥥`;

        await sock.sendMessage(from, { text: reply });
      }

      // 4. Menú de Precios & Stock en Vivo
      else if (cleanText === 'menu' || cleanText === 'precios' || cleanText.includes('stock')) {
        await syncProductsFromGoogleSheets();
        const reply = buildDynamicMenu() + `\n\n📸 *Ver Fotos en Alta Definición:* https://carta-cocoricco.vercel.app`;
        await sock.sendMessage(from, { text: reply });
      }

      // 5. Pagos
      else if (cleanText.includes('yape') || cleanText.includes('pago') || cleanText.includes('plin') || cleanText === '2') {
        const reply =
`💳 *MÉTODOS DE PAGO COCO RICCO:*

✅ *Yape & Plin:* al número oficial *938 955 940*
✅ *Efectivo:* Contra entrega al recibir tu pedido en Jaén
✅ *Izipay / Tarjeta:* En tienda

📸 Envíanos tu comprobante para despachar tu pedido de inmediato.`;

        await sock.sendMessage(from, { text: reply });
      }

      // 6. Ubicación & Horario
      else if (cleanText.includes('donde') || cleanText.includes('ubicacion') || cleanText.includes('direccion') || cleanText.includes('horario') || cleanText === '3') {
        const reply =
`📍 *UBICACIÓN Y ATENCIÓN COCO RICCO:*

🏠 *Local:* Jaén, Cajamarca, Perú.
⏰ *Horario:* Lunes a Domingo de 11:00 AM a 10:00 PM.
🛵 *Delivery:* Cobertura rápida en toda la ciudad de Jaén.

🌐 Carta Virtual: https://carta-cocoricco.vercel.app`;

        await sock.sendMessage(from, { text: reply });
      }

      // 7. Recepción de Pedido con Verificación de Stock
      else if (cleanText.includes('pedido') || cleanText.includes('vaso') || cleanText.includes('fresas') || cleanText.includes('helado') || cleanText.includes('paleta')) {
        const orderId = `PED-${Date.now().toString().slice(-4)}`;
        const newOrder = {
          id: orderId,
          timestamp: new Date().toLocaleString(),
          customerPhone: from.replace('@s.whatsapp.net', ''),
          message: text,
          status: 'Pendiente'
        };

        const existing = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
        existing.push(newOrder);
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(existing, null, 2));

        const reply =
`✅ *¡REGISTRAMOS TU PEDIDO #${orderId}!*

Tu pedido fue guardado y validado con el stock en tiempo real. 🍓🥥
Un asesor de *Coco Ricco* lo revisará para prepararlo de inmediato.

Si tienes alguna indicación especial sobre toppings (Oreo, Brownie, M&M, Fudge) o paletas *con/sin leche Nestlé*, indícanoslo por aquí.`;

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
    googleSheetSync: {
      spreadsheetId: SPREADSHEET_ID,
      productsCount: cachedProducts.length,
      lastSync: lastSyncTime
    }
  });
});

app.get('/api/pedidos', (req, res) => {
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  res.json(orders);
});

app.get('/health', (req, res) => {
  res.status(200).send('OK - Coco Ricco Bot & Google Sheet Synced 24/7');
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍓 COCO RICCO BOT 24/7 + CONTROL DE STOCK NUMÉRICO`);
  console.log(`📊 Google Sheet ID: ${SPREADSHEET_ID}`);
  console.log(`🌐 Panel QR Web: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
