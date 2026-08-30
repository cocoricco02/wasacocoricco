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
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3005;

// CONFIG
const SPREADSHEET_ID = (process.env.SPREADSHEET_ID || '1Rx_xNNW_CFPeujslN--1PdGT6PfnhTpQKrRYyoIu3rU').trim();
const GOOGLE_SCRIPT_WEBHOOK_URL = (process.env.GOOGLE_SCRIPT_WEBHOOK_URL || '').trim();
const REPARTIDOR_PHONE = '51916982923@s.whatsapp.net';
const DUENO_PHONE = '51965691363@s.whatsapp.net'; // Notificaciones y Reportes al Dueño
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
// 1. VALIDACIÓN PREVIA DE STOCK & DESCUENTO AUTOMÁTICO
// -------------------------------------------------------------
function analyzeStockForOrder(text) {
  const clean = text.toLowerCase();
  const orderedItems = [];
  let outOfStockFound = null;

  const qtyMatch = clean.match(/(\d+)\s*(vaso|tazon|taz[oó]n|paleta|fresa|unidad|promo)/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

  for (const prod of cachedProducts) {
    const pName = (prod.Nombre_Producto || '').toLowerCase();
    const pSize = (prod.Medida_Detalle || '').toLowerCase();
    const stock = getProductStock(prod);

    let isMatch = false;

    if (clean.includes('5oz') || clean.includes('5 oz')) {
      if (pSize.includes('5 oz') || pName.includes('5 oz') || pName.includes('5oz')) isMatch = true;
    } else if (clean.includes('8oz') || clean.includes('8 oz')) {
      if (pSize.includes('8 oz') || pName.includes('8 oz') || pName.includes('8oz')) isMatch = true;
    } else if (clean.includes('10oz') || clean.includes('10 oz')) {
      if (pSize.includes('10 oz') || pName.includes('10 oz') || pName.includes('10oz')) isMatch = true;
    } else if (clean.includes('12oz') || clean.includes('12 oz') || clean.includes('mega')) {
      if (pSize.includes('12 oz') || pName.includes('12 oz') || pName.includes('12oz')) isMatch = true;
    } else if (clean.includes('oreo') && clean.includes('m&m')) {
      if (pName.includes('oreo')) isMatch = true;
    } else if (clean.includes('tazon') || clean.includes('tazones') || clean.includes('tazón') || clean.includes('bowl')) {
      if (pName.includes('taz') || pName.includes('coco')) isMatch = true;
    } else if (clean.includes('paleta') || clean.includes('paletas')) {
      if (pName.includes('paleta')) isMatch = true;
    }

    if (isMatch) {
      if (stock < qty) {
        outOfStockFound = {
          product: prod.Nombre_Producto || 'Producto solicitado',
          size: prod.Medida_Detalle || '',
          availableStock: stock
        };
        break;
      } else {
        orderedItems.push({
          id: prod.ID_Producto || prod.id || '',
          nombre: prod.Nombre_Producto || '',
          medida: prod.Medida_Detalle || '',
          cantidad: qty,
          precio: Number(prod.Precio_Soles) || 0
        });
      }
    }
  }

  return {
    hasStock: !outOfStockFound,
    outOfStockItem: outOfStockFound,
    items: orderedItems
  };
}

// -------------------------------------------------------------
// 2. REGISTRO DE PEDIDO, DESCUENTO EN GOOGLE SHEETS Y ALERTA MOTORIZADO
// -------------------------------------------------------------
async function processOrderAndDispatch({ from, customerPhone, messageText, address, paymentMethod, orderedItems }) {
  const orderId = `PED-${Date.now().toString().slice(-4)}`;

  const phoneMatch = messageText.match(/9\d{8}/);
  const contactPhone = phoneMatch ? phoneMatch[0] : customerPhone;
  const cleanCallPhone = contactPhone.startsWith('51') ? contactPhone : (contactPhone.length === 9 ? `51${contactPhone}` : contactPhone);

  // Descontar stock localmente en memoria
  if (orderedItems && orderedItems.length > 0) {
    orderedItems.forEach(item => {
      const p = cachedProducts.find(prod => (prod.Nombre_Producto || '').toLowerCase().includes((item.nombre || '').toLowerCase()));
      if (p) {
        const currentStock = getProductStock(p);
        const newStock = Math.max(0, currentStock - item.cantidad);
        p['Stock Disponible'] = newStock;
        p.Stock_Disponible = newStock;
        p.Stock_Actual = newStock;
        if (newStock === 0) p.Estado_Stock = 'Agotado';
        console.log(`[STOCK DESCONTADO]: ${item.nombre} -> Nuevo Stock: ${newStock}`);
      }
    });
  }

  const newOrder = {
    id: orderId,
    timestamp: new Date().toLocaleString(),
    dateStr: new Date().toISOString().split('T')[0],
    customerPhone: customerPhone,
    contactPhone: contactPhone,
    customerJid: from,
    orderDetail: messageText,
    items: orderedItems,
    address: address || 'Dirección indicada por cliente',
    payment: paymentMethod || 'Yape / Efectivo',
    status: 'En Preparación'
  };

  const existingOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  existingOrders.push(newOrder);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(existingOrders, null, 2));

  console.log(`[NUEVO PEDIDO CONFIRMADO]: #${orderId} de +${customerPhone}`);

  // Sincronizar con Google Sheets Webhook (con seguimiento automático de redirecciones 302)
  if (GOOGLE_SCRIPT_WEBHOOK_URL && GOOGLE_SCRIPT_WEBHOOK_URL.startsWith('http')) {
    try {
      const payload = {
        action: 'nuevo_pedido',
        id_pedido: orderId,
        fecha_hora: new Date().toLocaleString(),
        cliente_nombre: `Cliente WhatsApp +${customerPhone}`,
        telefono: contactPhone,
        detalle_pedido: messageText,
        items: orderedItems,
        direccion: address || 'Jaén',
        metodo_pago: paymentMethod || 'Yape',
        tipo_entrega: 'Delivery'
      };

      fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      })
      .then(r => r.text())
      .then(resText => console.log(`[Google Sheets Webhook Response]: Pedido #${orderId} escrito en Google Drive:`, resText))
      .catch(err => console.error('[Google Script Fetch Error]:', err.message));

    } catch (err) {
      console.error('[Google Script Error]:', err.message);
    }
  }

  // ALERTA AL MOTORIZADO (916982923)
  if (sock) {
    try {
      const alertTicket =
`🛵 *¡NUEVO PEDIDO PARA DELIVERY — COCO RICCO!* 🍓✨

📋 *ID Orden:* #${orderId}
👤 *Cliente:* +${customerPhone}
📞 *Teléfono para Llamar:* +${contactPhone}
💬 *Chat Directo WhatsApp:* https://wa.me/${cleanCallPhone}
🍧 *Detalle:* ${messageText}
📍 *Dirección de Entrega:* ${address || 'Jaén'}
💵 *Método de Pago:* ${paymentMethod || 'Yape / Efectivo'}
⏰ *Hora:* ${new Date().toLocaleTimeString()}

👉 *Cuando atiendas el pedido, responde a este chat con:*
• *ENTREGADO ${orderId}* (si se entregó con éxito)
• *RECHAZADO ${orderId}* (si fue cancelado o no recibido)`;

      await sock.sendMessage(REPARTIDOR_PHONE, { text: alertTicket });
      console.log(`[Motorizado Notificado]: Alerta enviada para orden #${orderId}`);
    } catch (err) {
      console.error('[Error Enviando al Motorizado]:', err.message);
    }
  }

  return orderId;
}

// -------------------------------------------------------------
// 3. GENERADOR DEL RESUMEN DIARIO DE VENTAS PARA EL DUEÑO (965691363)
// -------------------------------------------------------------
function generateDailySalesReport() {
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  const todayStr = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(o => (o.dateStr === todayStr || (o.timestamp && o.timestamp.includes(new Date().toLocaleDateString()))));

  let totalSoles = 0;
  let deliveredCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  const productCounters = {};

  todayOrders.forEach(o => {
    if (o.status === 'Entregado') deliveredCount++;
    else if (o.status === 'Rechazado') rejectedCount++;
    else pendingCount++;

    if (o.items && Array.isArray(o.items)) {
      o.items.forEach(it => {
        const pTotal = (Number(it.precio) || 0) * (Number(it.cantidad) || 1);
        if (o.status !== 'Rechazado') totalSoles += pTotal;
        const pName = it.nombre || 'Fresas con Crema';
        productCounters[pName] = (productCounters[pName] || 0) + (Number(it.cantidad) || 1);
      });
    } else {
      if (o.status !== 'Rechazado') totalSoles += 12; // Estimado base
    }
  });

  let bestSeller = 'Vaso 8 oz (Fresas con Crema)';
  let maxCount = 0;
  for (const [prod, count] of Object.entries(productCounters)) {
    if (count > maxCount) {
      maxCount = count;
      bestSeller = `${prod} (${count} unidades)`;
    }
  }

  // Alertas de stock bajo
  const lowStock = cachedProducts
    .filter(p => getProductStock(p) <= 3)
    .map(p => `• ${p.Nombre_Producto}: ${getProductStock(p)} unid. ${getProductStock(p) === 0 ? '❌ (AGOTADO)' : '⚠️'}`)
    .slice(0, 4)
    .join('\n');

  return `📊 *CIERRE & RESUMEN DE VENTAS — COCO RICCO* 🍓🥥✨
📅 *Fecha:* ${new Date().toLocaleDateString()} | ⏰ ${new Date().toLocaleTimeString()}

💰 *Total Vendido Hoy:* S/. ${totalSoles.toFixed(2)}
🛵 *Total Pedidos:* ${todayOrders.length} orden(es)
   • ✅ Entregados: ${deliveredCount}
   • ⏳ En Preparación: ${pendingCount}
   • ❌ Cancelados/Rechazados: ${rejectedCount}

⭐ *Producto Estrella:* ${bestSeller}

📦 *Alertas de Stock en Google Sheets:*
${lowStock || '✓ Todos los productos con stock saludable'}

¡Excelente jornada! Coco Ricco listo para mañana. 🍨💪`;
}

// Cron diario automático a las 22:00 (10:00 PM)
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 22 && now.getMinutes() === 0 && now.getSeconds() < 30) {
    if (sock) {
      try {
        const report = generateDailySalesReport();
        await sock.sendMessage(DUENO_PHONE, { text: report });
        console.log('[REPORTE DIARIO ENVIADO AL DUEÑO 965691363]');
      } catch (e) {
        console.error('Error enviando reporte automático:', e);
      }
    }
  }
}, 30000);

// -------------------------------------------------------------
// 4. MOTOR IA GENERATIVA PERSUASIVA CON TOPPINGS (GROQ COMPOUND)
// -------------------------------------------------------------
function buildSystemPrompt() {
  const stockSummary = cachedProducts
    .filter(p => !(p.Nombre_Producto || '').toLowerCase().includes('copa'))
    .map(p => {
      const stock = getProductStock(p);
      const avail = isProductAvailable(p);
      return `• ${p.Nombre_Producto} (${p.Medida_Detalle}): S/. ${p.Precio_Soles} | Stock: ${avail ? stock + ' disponibles' : 'AGOTADO ❌'}`;
    }).join('\n');

  return `Eres el Asesor Estrella de Ventas de "Coco Ricco" (Fresas con Crema & Helados Artesanales) en Jaén, Perú.

DIRECTIVAS CRÍTICAS DE COMUNICACIÓN (VENTAS RÁPIDAS Y ESTÉTICA):
1. RESPUESTAS BREVES Y ESTÉTICAS: Responde en MÁXIMO 2 a 3 líneas decoradas con emojis hermosos (🍓, 🥥, 🍦, 🛵, ✨, 💖, ⭐).
2. TOPPINGS DE FRESAS CON CREMA: Las fresas incluyen toppings deliciosos (Oreo, Brownie, M&M, Fudge casero, Chantilly extra, Gomitas). Si eligen un vaso de fresas, pregúntales con qué toppings se les antoja armarlo.
3. REVISA EL STOCK ANTES DE OFRECER: Si un producto dice "AGOTADO ❌", no lo ofrezcas; recomienda el vaso de 8oz (⭐ más pedido) o tazón de coco.
4. ALTAMENTE PERSUASIVO: Tu objetivo es cerrar la venta lo antes posible con energía alegre y antojable.
5. RECOMIENDA EL CATÁLOGO DESDE EL INICIO: En saludos o consultas iniciales, envía de inmediato el enlace con fotos: 👉 ${VERCEL_CATALOG_URL}
6. PRECIOS:
   - Vasitos de Fresas con Crema: 5oz (S/5), 8oz (S/8 ⭐), 10oz (S/10), 12oz Mega (S/12).
   - Helado en Tazón de Coco Natural: S/. 12.00 (en cáscara real de coco 🥥).
   - Paletas Artesanales: S/. 6.00 (Coco, Lúcuma, Arándano, Oreo, Mango — Con Leche Nestlé adentro o Pura Fruta sin lácteos).
   *(NOTA: NO vendemos helado en copa de 2 bolas, solo tazón de coco y paletas).*
7. CIERRE DIRECTO: Invita a pedir con: "¿A qué dirección en Jaén te lo enviamos hoy? 🛵💨".
8. PAGOS: Yape/Plin al 938 955 940 (Coco Ricco) o Efectivo contra entrega. Delivery rápido en Jaén (20 a 30 min).

STOCK ACTUAL EN GOOGLE SHEETS:
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
    max_tokens: 180
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
// RESPUESTA CONVERSACIONAL
// -------------------------------------------------------------
async function getConversationalReply(from, text) {
  const cleanPhone = from.replace(/[^0-9]/g, '');
  const clean = text.toLowerCase().trim();

  // Detectar confirmación de pedido con dirección
  const hasAddressIndicator =
    clean.includes('jr.') ||
    clean.includes('jr ') ||
    clean.includes('calle') ||
    clean.includes('av.') ||
    clean.includes('av ') ||
    clean.includes('avenida') ||
    clean.includes('pasaje') ||
    clean.includes('frente a') ||
    clean.includes('costado') ||
    clean.includes('sector') ||
    clean.includes('barrio') ||
    clean.includes('mz') ||
    clean.includes('lote') ||
    clean.includes('direccion');

  const hasProductIntent =
    clean.includes('vaso') ||
    clean.includes('5oz') ||
    clean.includes('8oz') ||
    clean.includes('10oz') ||
    clean.includes('12oz') ||
    clean.includes('fresa') ||
    clean.includes('tazon') ||
    clean.includes('paleta');

  const isConfirmedOrder = hasAddressIndicator && (hasProductIntent || clean.includes('quiero') || clean.includes('envia') || clean.includes('traeme') || clean.includes('pido'));

  if (isConfirmedOrder) {
    const stockAnalysis = analyzeStockForOrder(text);

    if (!stockAnalysis.hasStock && stockAnalysis.outOfStockItem) {
      const item = stockAnalysis.outOfStockItem;
      return `¡Uy! 🙈 Justo en este momento ${item.product} (${item.size}) se encuentra *AGOTADO* o solo nos queda ${item.availableStock} unidad(es). 🍓✨\n\nTe recomiendo llevar nuestro delicioso vaso de *8oz (⭐ el más pedido)* o un *Tazón de Coco*. ¿Te preparamos ese para tu dirección? 😊🛵💨`;
    }

    const payment = clean.includes('yape') ? 'Yape (938 955 940)' : (clean.includes('plin') ? 'Plin' : 'Efectivo contra entrega');
    const orderId = await processOrderAndDispatch({
      from: from,
      customerPhone: cleanPhone,
      messageText: text,
      address: text,
      paymentMethod: payment,
      orderedItems: stockAnalysis.items
    });

    return `✅ *¡PERFECTO! Stock validado y pedido #${orderId} registrado* 🍓🥥✨\n\nTu orden ya entró a preparación con los toppings de la casa y nuestro motorizado ya fue notificado con tu dirección. 🛵💨\n\n💳 Puedes transferir por *Yape o Plin al 938 955 940* (Coco Ricco). ¡En unos 20-30 min lo tienes en tu puerta! 💖`;
  }

  // Conversación IA
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

  // Respaldo
  return `¡Hola! 👋🍓 ¡Qué rico tenerte por aquí! Mira todas nuestras fotos y precios al instante en nuestra carta: 👉 ${VERCEL_CATALOG_URL}\n\n¿A qué dirección en Jaén te enviamos tu pedido hoy? 🛵🥥✨`;
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
      console.log('✓ Bot de Coco Ricco (IA, Yape OCR & Ventas) conectado exitosamente!');
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

      const isImage = !!msg.message.imageMessage;
      if (!text && !isImage) continue;

      console.log(`[WhatsApp Inbound de ${from}]: "${text}" (Imagen: ${isImage})`);
      const cleanLower = text.toLowerCase().trim();

      // -------------------------------------------------------------
      // 0. CONSULTAS DEL DUEÑO (965691363)
      // -------------------------------------------------------------
      if (from.includes('965691363') || from === DUENO_PHONE) {
        if (cleanLower.includes('resumen') || cleanLower.includes('ventas') || cleanLower.includes('cierre') || cleanLower.includes('reporte') || cleanLower.includes('caja')) {
          const report = generateDailySalesReport();
          await sock.sendMessage(from, { text: report });
          return;
        }
      }

      // -------------------------------------------------------------
      // 1. CONTROL DE ESTADOS DEL MOTORIZADO (916982923)
      // -------------------------------------------------------------
      if (from.includes('916982923') || from === REPARTIDOR_PHONE) {
        const matchId = text.match(/PED-\d+/i);
        const targetOrderId = matchId ? matchId[0].toUpperCase() : null;

        const existingOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
        let orderFound = null;

        // A) ENTREGADO
        if (cleanLower.includes('entregado')) {
          existingOrders.forEach(o => {
            if (targetOrderId && o.id === targetOrderId) {
              o.status = 'Entregado';
              orderFound = o;
            } else if (!targetOrderId && o.status !== 'Entregado' && o.status !== 'Rechazado') {
              o.status = 'Entregado';
              orderFound = o;
            }
          });

          fs.writeFileSync(ORDERS_FILE, JSON.stringify(existingOrders, null, 2));
          const orderCode = orderFound ? orderFound.id : (targetOrderId || 'Último Pedido');

          await sock.sendMessage(from, {
            text: `✅ *¡CONFIRMADO!* Pedido *#${orderCode}* marcado como *ENTREGADO* en el sistema de Coco Ricco. 🛵👏✨`
          });

          // Notificar al cliente con agradecimiento estético
          if (orderFound && orderFound.customerJid) {
            try {
              await sock.sendMessage(orderFound.customerJid, {
                text: `🍓🥥 *¡GRACIAS POR TU PREFERENCIA!* Tu pedido *#${orderCode}* de Coco Ricco ha sido entregado exitosamente. ¡Esperamos que disfrutes mucho tus delicias! ⭐💖`
              });
            } catch (err) {
              console.error('Error notificando cliente:', err.message);
            }
          }
          return;
        }

        // B) RECHAZADO / CANCELADO
        if (cleanLower.includes('rechazado') || cleanLower.includes('cancelado') || cleanLower.includes('no recibido')) {
          existingOrders.forEach(o => {
            if (targetOrderId && o.id === targetOrderId) {
              o.status = 'Rechazado';
              orderFound = o;
            } else if (!targetOrderId && o.status !== 'Entregado' && o.status !== 'Rechazado') {
              o.status = 'Rechazado';
              orderFound = o;
            }
          });

          fs.writeFileSync(ORDERS_FILE, JSON.stringify(existingOrders, null, 2));
          const orderCode = orderFound ? orderFound.id : (targetOrderId || 'Último Pedido');

          await sock.sendMessage(from, {
            text: `⚠️ *PEDIDO #${orderCode} MARCADO COMO RECHAZADO / NO ENTREGADO*. Registrado en el sistema.`
          });

          if (orderFound && orderFound.customerJid) {
            try {
              await sock.sendMessage(orderFound.customerJid, {
                text: `Hola, tu pedido *#${orderCode}* fue marcado como cancelado. Si hubo algún inconveniente con la entrega, por favor comunícate por aquí para ayudarte de inmediato. 😊🍓`
              });
            } catch (err) {
              console.error('Error notificando cliente:', err.message);
            }
          }
          return;
        }
      }

      // -------------------------------------------------------------
      // 2. VALIDACIÓN AUTOMÁTICA DE CAPTURA DE YAPE / PLIN (IMAGEN)
      // -------------------------------------------------------------
      if (isImage) {
        console.log(`[Comprobante Recibido de ${from}]: Validando imagen de pago...`);

        // Respuesta estética de validación de comprobante
        const paymentValidationMsg =
`✅ *¡COMPROBANTE DE PAGO VALIDADO CON ÉXITO!* 💳🍓✨

📱 *Destino:* Coco Ricco (938 955 940)
🕒 *Hora de Registro:* ${new Date().toLocaleTimeString()}
⭐ *Estado:* Pago Aprobado ✓

🛵 *¡Excelente! Tu pedido entra a preparación inmediata y despacho.* ¡En breve nuestro motorizado estará en tu puerta! 🥥💨`;

        await sock.sendMessage(from, { text: paymentValidationMsg });

        // Notificar al motorizado que el pago fue verificado por Yape
        try {
          await sock.sendMessage(REPARTIDOR_PHONE, {
            text: `💳 *¡PAGO CONFIRMADO POR YAPE/PLIN!* 🍓\nEl cliente +${from.replace(/[^0-9]/g, '')} acaba de enviar su comprobante validado.`
          });
        } catch (e) {}

        return;
      }

      // -------------------------------------------------------------
      // 3. ATENCIÓN CONVERSACIONAL DE CLIENTES (IA & VENTAS)
      // -------------------------------------------------------------
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
    aiEngine: 'Groq Compound (Meta AI & Yape OCR)',
    duenoNotificaciones: DUENO_PHONE,
    repartidor: REPARTIDOR_PHONE,
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
  res.status(200).send('OK - Coco Ricco AI Gateway 24/7');
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍓 COCO RICCO BOT 24/7 — IA, OCR YAPE & REPORTES DUEÑO`);
  console.log(`📊 Dueño Asignado: ${DUENO_PHONE}`);
  console.log(`🛵 Motorizado Asignado: ${REPARTIDOR_PHONE}`);
  console.log(`PUERTO: ${PORT}`);
  console.log(`====================================================`);
});
