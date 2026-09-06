import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Sliders,
  RefreshCw,
  X,
  Lock,
  Eye,
  EyeOff,
  Milk,
  ShoppingCart,
  MapPin,
  Send,
  Plus,
  Minus,
  Trash2,
  Sparkles,
  ShoppingBag,
  Info,
  CreditCard,
  Banknote,
  Smartphone,
  ChevronRight
} from 'lucide-react';

// =============================================================
// 📱 CONFIGURACIÓN DEL NÚMERO DEL BOT (DESTINO DE PEDIDOS Y WEB)
// =============================================================
// Cambia este número si deseas enviar los pedidos a otro WhatsApp:
export const BOT_WHATSAPP_NUMBER = '51965691363'; // Con el 51 de Perú
export const BOT_WHATSAPP_DISPLAY = '965 691 363'; // Formato visual de la barra superior
// =============================================================

interface ProductItem {
  id: string;
  name: string;
  category: 'fresas' | 'coco_bowl' | 'helados' | 'paletas';
  sizeDetail: string;
  description: string;
  price: number;
  image: string;
  badge?: string;
  inStock: boolean;
  toppings: string[];
  maxToppings?: number;
  maxSyrups?: number;
  nestleOption?: boolean;
}

interface CartItem {
  id: string;
  productId: string;
  name: string;
  sizeDetail: string;
  price: number;
  quantity: number;
  selectedToppings: string[];
  selectedSyrups: string[];
  nestleChoice?: 'con' | 'sin';
  notes?: string;
}

const OFFICIAL_TOPPINGS = [
  'Chinchin',
  'Chocobombas',
  'Gomitas en Aro',
  'Gomitas Osito',
  'Gomitas Gusanito',
  'Gomitas en Cono',
  'Grajeas',
  'Chispas chocolate negro',
  'Chispas chocolate blanco',
  'Coco rayado',
  'Maní tostado',
  'Mini bombom',
  'Gomitas de perita',
  'Gomitas ácidas',
  'Galleta de Oreo',
  'Galleta Doña Pepa',
  'Casino menta'
];

const OFFICIAL_SYRUPS = [
  'Fudge Casero Artesanal',
  'Leche Condensada Cremosa',
  'Chantilly de la Casa',
  'Jalea de Fresa Natural'
];

const DEFAULT_PRODUCTS: ProductItem[] = [
  // FRESAS CON CREMA
  {
    id: 'fresas-vaso-12oz',
    name: 'Fresas con Crema — 12 oz Mega',
    category: 'fresas',
    sizeDetail: '12 oz • 4 Toppings + 3 Jarabes',
    description: 'Tamaño supremo con abundante fresa seleccionada, crema de autor y combinación gigante de toppings.',
    price: 12.0,
    image: '/assets/fresas-real-12oz.jpg',
    badge: '👑 12 oz Mega',
    inStock: true,
    maxToppings: 4,
    maxSyrups: 3,
    toppings: OFFICIAL_TOPPINGS
  },
  {
    id: 'fresas-vaso-10oz',
    name: 'Fresas con Crema — 10 oz Especial',
    category: 'fresas',
    sizeDetail: '10 oz • 4 Toppings + 3 Jarabes',
    description: 'Doble capa de fresas frescas con abundante crema batida de la casa. Incluye 4 toppings y 3 jarabes.',
    price: 10.0,
    image: '/assets/fresas-real-10oz.jpg',
    badge: '🔥 10 oz',
    inStock: true,
    maxToppings: 4,
    maxSyrups: 3,
    toppings: OFFICIAL_TOPPINGS
  },
  {
    id: 'fresas-vaso-8oz',
    name: 'Fresas con Crema — 8 oz Mediano',
    category: 'fresas',
    sizeDetail: '8 oz • 2 Toppings + 2 Jarabes',
    description: 'La porción perfecta de fresas dulces con crema artesanal. Incluye 2 toppings y 2 jarabes a tu elección.',
    price: 8.0,
    image: '/assets/fresas-real-8oz.jpg',
    badge: '⭐ Más Pedido',
    inStock: true,
    maxToppings: 2,
    maxSyrups: 2,
    toppings: OFFICIAL_TOPPINGS
  },
  {
    id: 'fresas-vaso-5oz',
    name: 'Fresas con Crema — 5 oz Personal',
    category: 'fresas',
    sizeDetail: '5 oz • Vaso Personal',
    description: 'Fresas frescas del día con crema artesanal batida, chispas y jalea dulce.',
    price: 5.0,
    image: '/assets/fresas-real-5oz.jpg',
    badge: '🍓 5 oz',
    inStock: true,
    maxToppings: 1,
    maxSyrups: 1,
    toppings: ['Chispas de Chocolate', 'Fudge Casero', 'Leche Condensada', 'Chantilly']
  },

  // HELADOS EN TAZÓN DE COCO REAL
  {
    id: 'helado-coco-natural-bowl',
    name: 'Helado en Tazón de Coco Natural',
    category: 'coco_bowl',
    sizeDetail: 'Servido en coco 100% natural',
    description: 'Helado artesanal ultra cremoso servido directamente en cáscara real de coco con topping a elección.',
    price: 12.0,
    image: '/assets/coco-natural-real.jpg',
    badge: '🥥 100% Coco Real',
    inStock: true,
    maxToppings: 2,
    maxSyrups: 2,
    toppings: ['Coco Rallado', 'Fudge Casero', 'Leche Condensada', 'Maní Tostado']
  },
  {
    id: 'helado-coco-maracuya-bowl',
    name: 'Helado en Coco + Maracuyá',
    category: 'coco_bowl',
    sizeDetail: 'Servido en coco natural',
    description: 'Helado artesanal en coco bañado con jalea y semillas naturales de maracuyá agridulce.',
    price: 12.0,
    image: '/assets/coco-maracuya-real.jpg',
    badge: '🔥 Tropical',
    inStock: true,
    maxToppings: 2,
    maxSyrups: 2,
    toppings: ['Sirope Maracuyá', 'Coco Rallado', 'Fudge Casero', 'Leche Condensada']
  },

  // PALETAS ARTESANALES (CON O SIN LECHE NESTLÉ)
  {
    id: 'paleta-fudge-artesanal',
    name: 'Paleta Rellena de Fudge',
    category: 'paletas',
    sizeDetail: 'Centro de Fudge Casero',
    description: 'Helado cremoso con centro fluido de fudge de chocolate oscuro casero.',
    price: 6.0,
    image: '/assets/paleta-fudge-real.jpg',
    badge: '🍫 Fudge',
    inStock: true,
    nestleOption: false,
    toppings: ['Centro de Fudge Casero']
  },
  {
    id: 'paleta-oreo-nestle',
    name: 'Paleta de Oreo',
    category: 'paletas',
    sizeDetail: 'Con o Sin Leche Nestlé',
    description: 'Helado cremoso con trozos de galleta Oreo original y opción de relleno Nestlé.',
    price: 6.0,
    image: '/assets/paleta-oreo-real.jpg',
    badge: '🍪 Oreo',
    inStock: true,
    nestleOption: true,
    toppings: ['Con Leche Nestlé', 'Sin Leche Nestlé (Pura Fruta)']
  },
  {
    id: 'paleta-coco-nestle',
    name: 'Paleta de Coco',
    category: 'paletas',
    sizeDetail: 'Con o Sin Leche Nestlé',
    description: 'Paleta de coco natural. Disponible rellena con leche Nestlé adentro o pura fruta sin leche.',
    price: 6.0,
    image: '/assets/paleta-coco-real.jpg',
    badge: '🥥 Coco',
    inStock: true,
    nestleOption: true,
    toppings: ['Con Leche Nestlé', 'Sin Leche Nestlé']
  },
  {
    id: 'paleta-arandano-nestle',
    name: 'Paleta de Arándano',
    category: 'paletas',
    sizeDetail: 'Con o Sin Leche Nestlé',
    description: 'Paleta artesanal de arándanos frescos con corazón de leche Nestlé adentro o 100% fruta.',
    price: 6.0,
    image: '/assets/paleta-arandano-real.jpg',
    badge: '🫐 Arándano',
    inStock: true,
    nestleOption: true,
    toppings: ['Con Leche Nestlé', 'Sin Leche Nestlé']
  },
  {
    id: 'paleta-lucuma-nestle',
    name: 'Paleta de Lúcuma',
    category: 'paletas',
    sizeDetail: 'Con o Sin Leche Nestlé',
    description: 'Pura lúcuma de seda en paleta cremosa. Disponible rellena con leche Nestlé o sin leche.',
    price: 6.0,
    image: '/assets/paleta-lucuma-real.jpg',
    badge: '✨ Lúcuma',
    inStock: true,
    nestleOption: true,
    toppings: ['Con Leche Nestlé', 'Sin Leche Nestlé']
  },
  {
    id: 'paleta-tropical-mango-aguaje',
    name: 'Helado de Mango',
    category: 'paletas',
    sizeDetail: '100% Pulpa de Mango Natural',
    description: 'Paleta artesanal refrescante elaborada con pulpa 100% natural de mango de selección.',
    price: 6.0,
    image: '/assets/paleta-mango-real.jpg',
    badge: '🥭 Mango Natural',
    inStock: true,
    nestleOption: false,
    toppings: ['Pulpa 100% Natural']
  }
];

export default function App() {
  const [products, setProducts] = useState<ProductItem[]>(DEFAULT_PRODUCTS);
  const [activeCategory, setActiveCategory] = useState<string>('todos');
  const [appMode, setAppMode] = useState<'catalogo' | 'delivery'>('catalogo');
  
  // Cart & Delivery state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customizingProduct, setCustomizingProduct] = useState<ProductItem | null>(null);
  const [tempToppings, setTempToppings] = useState<string[]>([]);
  const [tempSyrups, setTempSyrups] = useState<string[]>([]);
  const [tempNestle, setTempNestle] = useState<'con' | 'sin'>('con');
  const [tempNotes, setTempNotes] = useState('');
  const [tempQty, setTempQty] = useState(1);

  // Delivery Form
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Yape' | 'Plin' | 'Efectivo Contra Entrega' | 'Tarjeta Contra Entrega'>('Yape');
  const [cashAmount, setCashAmount] = useState('');

  // Admin state
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [selectedProductView, setSelectedProductView] = useState<ProductItem | null>(null);

  // Check URL query on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'delivery') {
      setAppMode('delivery');
    }

    const saved = localStorage.getItem('cocoricco_carta_v9');
    if (saved) {
      try {
        setProducts(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading saved catalog', e);
      }
    }
  }, []);

  const saveCatalog = (updated: ProductItem[]) => {
    setProducts(updated);
    localStorage.setItem('cocoricco_carta_v9', JSON.stringify(updated));
  };

  const resetToDefault = () => {
    setProducts(DEFAULT_PRODUCTS);
    localStorage.setItem('cocoricco_carta_v9', JSON.stringify(DEFAULT_PRODUCTS));
  };

  const handleOpenAdmin = () => {
    if (isAuthenticated) {
      setIsAdminOpen(true);
    } else {
      setPasswordInput('');
      setAuthError('');
      setIsAuthModalOpen(true);
    }
  };

  const handleVerifyPassword = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (passwordInput === 'cocoricco2027') {
      setIsAuthenticated(true);
      setIsAuthModalOpen(false);
      setIsAdminOpen(true);
      setAuthError('');
    } else {
      setAuthError('Contraseña incorrecta. Inténtalo de nuevo.');
    }
  };

  const toggleStock = (id: string) => {
    const updated = products.map((p) =>
      p.id === id ? { ...p, inStock: !p.inStock } : p
    );
    saveCatalog(updated);
  };

  const updatePrice = (id: string, newPrice: number) => {
    const updated = products.map((p) =>
      p.id === id ? { ...p, price: newPrice } : p
    );
    saveCatalog(updated);
  };

  // Customization & Cart handlers
  const openCustomizer = (product: ProductItem) => {
    setCustomizingProduct(product);
    setTempToppings([]);
    setTempSyrups([]);
    setTempNestle('con');
    setTempNotes('');
    setTempQty(1);
  };

  const toggleTopping = (topping: string, max: number) => {
    if (tempToppings.includes(topping)) {
      setTempToppings(tempToppings.filter((t) => t !== topping));
    } else {
      if (tempToppings.length < max) {
        setTempToppings([...tempToppings, topping]);
      }
    }
  };

  const toggleSyrup = (syrup: string, max: number) => {
    if (tempSyrups.includes(syrup)) {
      setTempSyrups(tempSyrups.filter((s) => s !== syrup));
    } else {
      if (tempSyrups.length < max) {
        setTempSyrups([...tempSyrups, syrup]);
      }
    }
  };

  const addToCart = () => {
    if (!customizingProduct) return;
    const newItem: CartItem = {
      id: `${customizingProduct.id}-${Date.now()}`,
      productId: customizingProduct.id,
      name: customizingProduct.name,
      sizeDetail: customizingProduct.sizeDetail,
      price: customizingProduct.price,
      quantity: tempQty,
      selectedToppings: tempToppings,
      selectedSyrups: tempSyrups,
      nestleChoice: customizingProduct.nestleOption ? tempNestle : undefined,
      notes: tempNotes
    };
    setCart([...cart, newItem]);
    setCustomizingProduct(null);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter((item) => item.id !== id));
  };

  const updateCartQty = (id: string, delta: number) => {
    setCart(
      cart
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);

  // Send WhatsApp Order
  const handleSendOrderWhatsApp = () => {
    if (cart.length === 0) {
      alert('Tu carrito está vacío. Agrega al menos un producto.');
      return;
    }
    if (!customerAddress.trim()) {
      alert('Por favor, ingresa tu dirección exacta de entrega en Jaén.');
      return;
    }

    let itemsText = '';
    cart.forEach((it, idx) => {
      itemsText += `\n${idx + 1}. *${it.quantity}x ${it.name}* (S/. ${(it.price * it.quantity).toFixed(2)})`;
      if (it.selectedToppings.length > 0) {
        itemsText += `\n   • Toppings: ${it.selectedToppings.join(', ')}`;
      }
      if (it.selectedSyrups.length > 0) {
        itemsText += `\n   • Jarabes: ${it.selectedSyrups.join(', ')}`;
      }
      if (it.nestleChoice) {
        itemsText += `\n   • Opción: ${it.nestleChoice === 'con' ? 'Con Leche Nestlé' : 'Sin Leche (Pura Fruta)'}`;
      }
      if (it.notes) {
        itemsText += `\n   • Nota: ${it.notes}`;
      }
    });

    let paymentText: string = paymentMethod;
    if (paymentMethod === 'Efectivo Contra Entrega') {
      paymentText = `Efectivo Contra Entrega ${cashAmount ? `(Paga con billete de S/. ${cashAmount})` : ''}`;
    } else if (paymentMethod === 'Yape') {
      paymentText = 'Yape (938 955 940)';
    } else if (paymentMethod === 'Plin') {
      paymentText = 'Plin (938 955 940)';
    }

    const message =
`🛵 *PEDIDO DE DELIVERY — COCO RICCO* 🍓✨

📍 *Dirección de Entrega:* ${customerAddress.trim()}
👤 *Cliente:* ${customerName.trim() || 'Cliente'}
📞 *Teléfono de Contacto:* ${customerPhone.trim() || 'El de este WhatsApp'}
💵 *Método de Pago:* ${paymentText}

🍧 *PRODUCTOS SOLICITADOS:*${itemsText}

💰 *TOTAL A PAGAR:* S/. ${cartTotal.toFixed(2)}

👉 *Por favor registrar mi orden, validar stock y despachar al motorizado.* 🛵💨`;

    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${BOT_WHATSAPP_NUMBER}?text=${encoded}`, '_blank');
  };

  const filteredProducts = products.filter((p) => {
    if (activeCategory === 'todos') return true;
    if (activeCategory === 'fresas') return p.category === 'fresas';
    if (activeCategory === 'coco_bowl') return p.category === 'coco_bowl';
    if (activeCategory === 'paletas') return p.category === 'paletas';
    return true;
  });

  return (
    <div className="min-h-screen bg-[#120A07] text-[#FFF5EB] font-sans selection:bg-[#E84A5F] selection:text-white pb-28">
      {/* TOP NOTIFICATION BAR */}
      <div className="bg-[#0A0503] text-[#E0D0C5] px-4 py-2 text-xs md:text-sm font-medium flex items-center justify-between border-b border-[#2A1710]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-[#D6C7BC]">🍓 Fresas con Crema, Helados en Coco & Paletas • Jaén</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`https://wa.me/${BOT_WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 font-bold transition-colors"
          >
            <Phone size={14} />
            <span className="hidden sm:inline">WhatsApp:</span> {BOT_WHATSAPP_DISPLAY}
          </a>
          <button
            onClick={handleOpenAdmin}
            className="text-xs bg-[#24130C] hover:bg-[#341B12] px-2.5 py-1 rounded-lg text-amber-200/80 border border-[#3D2015] flex items-center gap-1 transition-colors"
          >
            <Sliders size={12} />
            <span className="hidden md:inline">Admin</span>
          </button>
        </div>
      </div>

      {/* HEADER WITH NATIVE DARK MINIMALIST TOGGLE */}
      <header className="sticky top-0 z-40 bg-[#160D09]/95 backdrop-blur-md border-b border-[#2E1811] px-4 py-3 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-[#E84A5F]/80 shadow-md bg-[#24130C] p-0.5">
              <img src="./assets/logo.png" alt="Coco Ricco Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-[#FFF5EB] flex items-center gap-1.5">
                COCO RICCO <span className="text-[#E84A5F]">🍓</span>
              </h1>
              <p className="text-[11px] text-[#A69085] font-medium">Fresas con Crema & Heladería Artesanal</p>
            </div>
          </div>

          {/* MODE TOGGLE: CARTA vs DELIVERY */}
          <div className="flex items-center bg-[#22130D] p-1 rounded-2xl border border-[#3A1F16]">
            <button
              onClick={() => setAppMode('catalogo')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                appMode === 'catalogo'
                  ? 'bg-[#3D2015] text-amber-200 shadow-sm border border-amber-500/20'
                  : 'text-[#968075] hover:text-[#FFF5EB]'
              }`}
            >
              📋 Carta
            </button>
            <button
              onClick={() => setAppMode('delivery')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                appMode === 'delivery'
                  ? 'bg-[#E84A5F] text-white shadow-md'
                  : 'text-[#968075] hover:text-[#E84A5F]'
              }`}
            >
              🛵 Delivery
              {cart.length > 0 && (
                <span className="bg-white text-[#E84A5F] px-1.5 py-0.2 rounded-full text-[10px] font-black">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* HERO BANNER */}
      <section className="max-w-6xl mx-auto px-4 pt-5 pb-3">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#20100A] via-[#331910] to-[#20100A] border border-[#3E2016] text-[#FFF5EB] p-6 md:p-8 shadow-2xl">
          <div className="relative z-10 max-w-xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E84A5F]/20 text-[#FF758F] border border-[#E84A5F]/40 text-xs font-bold tracking-wide uppercase mb-3">
              <Sparkles size={13} className="text-[#FF758F]" /> {appMode === 'delivery' ? 'Delivery Express Jaén' : 'Recetas 100% Artesanales'}
            </span>
            <h2 className="text-2xl md:text-3xl font-black leading-tight mb-2 text-[#FFF5EB]">
              {appMode === 'delivery' ? (
                <>Arma tu pedido y recíbelo en tu puerta 🛵🍓</>
              ) : (
                <>Fresas seleccionadas con crema y helados reales 🍨✨</>
              )}
            </h2>
            <p className="text-[#C4B2A7] text-xs md:text-sm mb-4">
              {appMode === 'delivery'
                ? 'Elige tus vasos, selecciona tus toppings favoritos, coloca tu dirección y te lo despachamos en 20-30 min.'
                : '17 toppings oficiales, cáscaras reales de coco y paletas rellenas con leche Nestlé.'}
            </p>
            {appMode === 'catalogo' ? (
              <button
                onClick={() => setAppMode('delivery')}
                className="bg-[#E84A5F] hover:bg-[#D43B50] text-white font-bold px-5 py-2.5 rounded-2xl text-xs md:text-sm flex items-center gap-2 shadow-lg transition-all"
              >
                <ShoppingBag size={16} /> Hacer Pedido para Delivery
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-300 font-semibold bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-xl backdrop-blur-sm w-fit">
                <MapPin size={14} className="text-[#E84A5F]" /> Envíos a todo Jaén • Pagos con Yape/Plin o Contra Entrega
              </div>
            )}
          </div>
        </div>
      </section>

      {/* CATEGORY FILTER */}
      <section className="max-w-6xl mx-auto px-4 py-2 sticky top-[62px] z-30 bg-[#120A07]/90 backdrop-blur-md">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {[
            { id: 'todos', label: '⭐ Todos los Productos' },
            { id: 'fresas', label: '🍓 Fresas con Crema' },
            { id: 'coco_bowl', label: '🥥 Helados en Coco' },
            { id: 'paletas', label: '🍧 Paletas Artesanales' }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-2xl text-xs md:text-sm font-bold whitespace-nowrap transition-all ${
                activeCategory === cat.id
                  ? 'bg-[#E84A5F] text-white shadow-md'
                  : 'bg-[#22130D] text-[#A69085] hover:bg-[#2C1911] border border-[#351C14]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </section>

      {/* PRODUCTS GRID */}
      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <motion.div
              layout
              key={product.id}
              className={`group bg-[#1D100A] rounded-3xl overflow-hidden border border-[#331C13] shadow-lg hover:border-[#E84A5F]/40 transition-all flex flex-col justify-between ${
                !product.inStock ? 'opacity-50 grayscale-[50%]' : ''
              }`}
            >
              {/* Image & Badge */}
              <div
                className="relative h-72 sm:h-80 bg-[#160D09] flex items-center justify-center p-2.5 overflow-hidden cursor-pointer"
                onClick={() => setSelectedProductView(product)}
              >
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500 rounded-2xl drop-shadow-md"
                />
                {product.badge && (
                  <span className="absolute top-3 left-3 bg-[#E84A5F] text-white text-xs font-black px-3 py-1 rounded-full shadow-md">
                    {product.badge}
                  </span>
                )}
                {!product.inStock && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                    <span className="bg-red-600 text-white font-black text-xs px-4 py-2 rounded-full uppercase tracking-wider shadow-lg">
                      Agotado Temporalmente
                    </span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <h3 className="font-extrabold text-base md:text-lg text-[#FFF5EB] leading-tight">{product.name}</h3>
                    <span className="text-xl font-black text-[#E84A5F] whitespace-nowrap ml-2">
                      S/. {product.price.toFixed(2)}
                    </span>
                  </div>
                  <span className="inline-block text-[11px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 rounded-lg mb-2">
                    {product.sizeDetail}
                  </span>
                  <p className="text-xs text-[#BAA79C] leading-relaxed mb-4">{product.description}</p>
                </div>

                {/* Toppings / Actions */}
                <div className="pt-3 border-t border-[#2D1810]">
                  {product.category === 'fresas' && (
                    <div className="mb-3">
                      <p className="text-[11px] font-bold text-amber-400/90 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                        <Sparkles size={12} className="text-amber-400" />
                        Toppings & Jarabes incluidos:
                      </p>
                      <p className="text-xs text-[#D6C7BC] font-medium">
                        {product.maxToppings} toppings + {product.maxSyrups} jarabes a elección
                      </p>
                    </div>
                  )}

                  {appMode === 'delivery' ? (
                    <button
                      disabled={!product.inStock}
                      onClick={() => openCustomizer(product)}
                      className={`w-full py-2.5 px-4 rounded-2xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
                        product.inStock
                          ? 'bg-[#E84A5F] hover:bg-[#D43B50] text-white shadow-md active:scale-98'
                          : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      <ShoppingCart size={16} /> Personalizar & Agregar
                    </button>
                  ) : (
                    <button
                      onClick={() => setSelectedProductView(product)}
                      className="w-full py-2.5 px-4 rounded-2xl font-bold text-xs text-[#FFF5EB] bg-[#2A160F] hover:bg-[#381D14] border border-[#3E2117] transition-all flex items-center justify-center gap-1.5"
                    >
                      <Info size={15} className="text-amber-400" /> Ver Detalles & Fotos
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </main>

      {/* FLOATING CART BAR FOR MOBILE & DESKTOP (DELIVERY MODE) */}
      {appMode === 'delivery' && cart.length > 0 && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-4 left-0 right-0 z-40 max-w-lg mx-auto px-4"
        >
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full bg-[#E84A5F] hover:bg-[#D43B50] text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between border border-white/20 transition-transform active:scale-95"
          >
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <ShoppingCart size={20} />
              </div>
              <div className="text-left">
                <p className="text-[11px] font-medium text-white/80">
                  {cart.reduce((a, b) => a + b.quantity, 0)} ítem(s) en tu carrito
                </p>
                <p className="text-sm font-black">Continuar con mi Pedido</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black bg-white text-[#E84A5F] px-3 py-1 rounded-xl shadow">
                S/. {cartTotal.toFixed(2)}
              </span>
              <ChevronRight size={18} />
            </div>
          </button>
        </motion.div>
      )}

      {/* CUSTOMIZE MODAL (DARK MINIMAL) */}
      <AnimatePresence>
        {customizingProduct && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-[#1C100B] text-[#FFF5EB] border border-[#381F17] rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex gap-3">
                    <img
                      src={customizingProduct.image}
                      alt={customizingProduct.name}
                      className="w-16 h-16 rounded-2xl object-cover border border-[#381F17]"
                    />
                    <div>
                      <h3 className="font-extrabold text-base md:text-lg text-[#FFF5EB]">{customizingProduct.name}</h3>
                      <p className="text-xs text-[#A69085]">{customizingProduct.sizeDetail}</p>
                      <p className="text-sm font-black text-[#E84A5F]">S/. {customizingProduct.price.toFixed(2)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setCustomizingProduct(null)}
                    className="p-1 rounded-full bg-[#2A160F] text-[#C4B2A7] hover:bg-[#381D14]"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* TOPPINGS SELECTION */}
                {customizingProduct.maxToppings && customizingProduct.maxToppings > 0 && (
                  <div className="mb-5 bg-[#24130C] p-4 rounded-2xl border border-[#351C13]">
                    <div className="flex justify-between items-center mb-2.5">
                      <label className="text-xs font-black text-[#FFF5EB] uppercase tracking-wider">
                        Elige tus Toppings ({tempToppings.length}/{customizingProduct.maxToppings})
                      </label>
                      <span className="text-[11px] text-amber-400 font-bold">
                        Máx. {customizingProduct.maxToppings}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                      {OFFICIAL_TOPPINGS.map((top) => {
                        const isSelected = tempToppings.includes(top);
                        return (
                          <button
                            key={top}
                            onClick={() => toggleTopping(top, customizingProduct.maxToppings || 2)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                              isSelected
                                ? 'bg-[#E84A5F] text-white shadow-sm'
                                : 'bg-[#190C07] text-[#C4B2A7] border border-[#331B12] hover:border-[#E84A5F]/50'
                            }`}
                          >
                            {isSelected ? '✓ ' : '+ '}
                            {top}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* SYRUPS SELECTION */}
                {customizingProduct.maxSyrups && customizingProduct.maxSyrups > 0 && (
                  <div className="mb-5 bg-[#24130C] p-4 rounded-2xl border border-[#351C13]">
                    <div className="flex justify-between items-center mb-2.5">
                      <label className="text-xs font-black text-[#FFF5EB] uppercase tracking-wider">
                        Elige tus Jarabes ({tempSyrups.length}/{customizingProduct.maxSyrups})
                      </label>
                      <span className="text-[11px] text-amber-400 font-bold">Máx. {customizingProduct.maxSyrups}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {OFFICIAL_SYRUPS.map((syr) => {
                        const isSelected = tempSyrups.includes(syr);
                        return (
                          <button
                            key={syr}
                            onClick={() => toggleSyrup(syr, customizingProduct.maxSyrups || 2)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                              isSelected
                                ? 'bg-[#E84A5F] text-white shadow-sm'
                                : 'bg-[#190C07] text-[#C4B2A7] border border-[#331B12] hover:border-[#E84A5F]/50'
                            }`}
                          >
                            {isSelected ? '✓ ' : '+ '}
                            {syr}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PALETAS NESTLE OPTION */}
                {customizingProduct.nestleOption && (
                  <div className="mb-4 bg-[#24130C] p-4 rounded-2xl border border-[#351C13]">
                    <label className="block text-xs font-black text-[#FFF5EB] uppercase tracking-wider mb-2">
                      Tipo de Relleno
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setTempNestle('con')}
                        className={`p-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          tempNestle === 'con'
                            ? 'bg-[#E84A5F] text-white shadow-sm'
                            : 'bg-[#190C07] text-[#C4B2A7] border border-[#331B12]'
                        }`}
                      >
                        <Milk size={14} /> Con Leche Nestlé
                      </button>
                      <button
                        onClick={() => setTempNestle('sin')}
                        className={`p-2.5 rounded-xl text-xs font-bold transition-all ${
                          tempNestle === 'sin'
                            ? 'bg-[#E84A5F] text-white shadow-sm'
                            : 'bg-[#190C07] text-[#C4B2A7] border border-[#331B12]'
                        }`}
                      >
                        Pura Fruta (Sin Leche)
                      </button>
                    </div>
                  </div>
                )}

                {/* NOTES */}
                <div className="mb-4">
                  <label className="block text-xs font-bold text-[#A69085] mb-1">
                    Instrucciones Especiales (Opcional):
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Poco dulce, chantilly aparte, etc."
                    value={tempNotes}
                    onChange={(e) => setTempNotes(e.target.value)}
                    className="w-full text-xs p-3 rounded-xl border border-[#351C13] bg-[#24130C] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F]"
                  />
                </div>
              </div>

              {/* QUANTITY & ADD BUTTON */}
              <div className="pt-4 border-t border-[#2E1811] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 bg-[#24130C] px-3 py-1.5 rounded-2xl border border-[#351C13]">
                  <button
                    onClick={() => setTempQty(Math.max(1, tempQty - 1))}
                    className="p-1 text-[#C4B2A7] hover:text-white"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="font-black text-sm w-6 text-center text-[#FFF5EB]">{tempQty}</span>
                  <button
                    onClick={() => setTempQty(tempQty + 1)}
                    className="p-1 text-[#C4B2A7] hover:text-white"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <button
                  onClick={addToCart}
                  className="flex-1 bg-[#E84A5F] hover:bg-[#D43B50] text-white font-bold py-3 px-4 rounded-2xl text-xs md:text-sm shadow-lg flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} /> Agregar (S/. {(customizingProduct.price * tempQty).toFixed(2)})
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CART & DELIVERY CHECKOUT MODAL (DRAWER OPTIMIZADO) */}
      <AnimatePresence>
        {isCartOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-[#1C100B] text-[#FFF5EB] border border-[#381F17] rounded-t-3xl sm:rounded-3xl max-w-xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-3.5 border-b border-[#2E1811] mb-4">
                  <h3 className="text-lg md:text-xl font-black text-[#FFF5EB] flex items-center gap-2">
                    <ShoppingCart className="text-[#E84A5F]" /> Tu Pedido de Delivery
                  </h3>
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="p-1.5 rounded-full bg-[#2A160F] text-[#C4B2A7] hover:bg-[#381D14]"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* CART ITEMS LIST */}
                {cart.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-[#A69085] font-medium mb-3">Tu carrito está vacío.</p>
                    <button
                      onClick={() => setIsCartOpen(false)}
                      className="bg-[#E84A5F] text-white text-xs font-bold px-5 py-2.5 rounded-xl"
                    >
                      Explorar la Carta
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 mb-5 max-h-56 overflow-y-auto pr-1">
                    {cart.map((item) => (
                      <div
                        key={item.id}
                        className="bg-[#24130C] p-3 rounded-2xl border border-[#351C13] flex items-center justify-between gap-3"
                      >
                        <div className="flex-1">
                          <h4 className="text-xs font-black text-[#FFF5EB]">{item.name}</h4>
                          <p className="text-[11px] text-[#A69085]">{item.sizeDetail}</p>
                          {item.selectedToppings.length > 0 && (
                            <p className="text-[10px] text-[#FF758F] font-bold">
                              Toppings: {item.selectedToppings.join(', ')}
                            </p>
                          )}
                          {item.selectedSyrups.length > 0 && (
                            <p className="text-[10px] text-amber-300/90 font-semibold">
                              Jarabes: {item.selectedSyrups.join(', ')}
                            </p>
                          )}
                          {item.nestleChoice && (
                            <p className="text-[10px] text-stone-300 font-semibold">
                              {item.nestleChoice === 'con' ? '✓ Con Leche Nestlé' : '✓ Sin Leche'}
                            </p>
                          )}
                          <p className="text-xs font-black text-[#E84A5F] mt-1">
                            S/. {(item.price * item.quantity).toFixed(2)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 bg-[#170C07] px-2 py-1 rounded-xl border border-[#331B12]">
                          <button
                            onClick={() => updateCartQty(item.id, -1)}
                            className="text-[#C4B2A7] hover:text-white p-0.5"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="text-xs font-black w-4 text-center text-[#FFF5EB]">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQty(item.id, 1)}
                            className="text-[#C4B2A7] hover:text-white p-0.5"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-red-400 hover:text-red-300 p-1"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* DELIVERY ADDRESS FORM */}
                {cart.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-[#2E1811]">
                    <h4 className="text-xs font-black text-[#FFF5EB] uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={15} className="text-[#E84A5F]" /> Datos de Entrega en Jaén
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-[#A69085] mb-1">Tu Nombre:</label>
                        <input
                          type="text"
                          placeholder="Ej. Juan Pérez"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="w-full text-xs p-2.5 rounded-xl border border-[#351C13] bg-[#24130C] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#A69085] mb-1">Tu Teléfono:</label>
                        <input
                          type="tel"
                          placeholder="Ej. 965 691 363"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          className="w-full text-xs p-2.5 rounded-xl border border-[#351C13] bg-[#24130C] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-[#FF758F] mb-1">
                        Dirección Exacta & Referencia en Jaén (*Obligatorio para Delivery):
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Jr. San Martín 450 (Frente al parque, portón marrón)"
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        className="w-full text-xs p-3 rounded-xl border-2 border-[#E84A5F]/50 bg-[#24130C] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F] font-medium"
                      />
                    </div>

                    {/* PAYMENT METHOD (INCLUYE CONTRA ENTREGA) */}
                    <div>
                      <label className="block text-[11px] font-bold text-[#A69085] mb-1.5">Método de Pago:</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'Yape', label: '💳 Yape (938 955 940)', icon: Smartphone },
                          { id: 'Plin', label: '📱 Plin (938 955 940)', icon: Smartphone },
                          { id: 'Efectivo Contra Entrega', label: '💵 Efectivo Contra Entrega', icon: Banknote },
                          { id: 'Tarjeta Contra Entrega', label: '💳 Tarjeta / POS Contra Entrega', icon: CreditCard }
                        ].map((m) => {
                          const isSel = paymentMethod === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setPaymentMethod(m.id as any)}
                              className={`p-2.5 rounded-xl text-[11px] font-bold text-left transition-all flex items-center gap-1.5 ${
                                isSel
                                  ? 'bg-[#E84A5F] text-white shadow-sm border border-white/20'
                                  : 'bg-[#24130C] text-[#C4B2A7] border border-[#351C13] hover:border-[#E84A5F]/40'
                              }`}
                            >
                              <m.icon size={14} className={isSel ? 'text-white' : 'text-amber-400'} />
                              <span className="truncate">{m.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {paymentMethod === 'Efectivo Contra Entrega' && (
                        <div className="mt-2.5 bg-[#24130C] p-2.5 rounded-xl border border-[#351C13]">
                          <label className="block text-[11px] font-bold text-amber-300 mb-1">
                            ¿Con cuánto vas a pagar? (Para que el motorizado lleve tu vuelto exacto):
                          </label>
                          <input
                            type="text"
                            placeholder="Ej. S/ 20 o S/ 50"
                            value={cashAmount}
                            onChange={(e) => setCashAmount(e.target.value)}
                            className="w-full text-xs p-2 rounded-lg border border-[#351C13] bg-[#170C07] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* TOTAL & CONFIRM BUTTON */}
              {cart.length > 0 && (
                <div className="pt-4 border-t border-[#2E1811] mt-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-[#A69085]">Total a Pagar (Productos):</span>
                    <span className="text-2xl font-black text-[#E84A5F]">S/. {cartTotal.toFixed(2)}</span>
                  </div>

                  <button
                    onClick={handleSendOrderWhatsApp}
                    className="w-full bg-[#25D366] hover:bg-[#1EBE5D] text-white font-black py-3.5 px-6 rounded-2xl text-sm shadow-xl flex items-center justify-center gap-2 transition-all transform active:scale-98"
                  >
                    <Send size={18} /> Confirmar y Enviar Pedido a WhatsApp
                  </button>
                  <p className="text-[10px] text-center text-[#A69085] mt-2 font-medium">
                    ⚡ Nuestro Bot 24/7 procesará tu orden y notificará de inmediato al motorizado en Jaén.
                  </p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DETAIL MODAL (CATALOG MODE) */}
      <AnimatePresence>
        {selectedProductView && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1C100B] text-[#FFF5EB] border border-[#381F17] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl"
            >
              <div className="relative h-80 sm:h-96 bg-[#160D09] flex items-center justify-center p-3 overflow-hidden">
                <img
                  src={selectedProductView.image}
                  alt={selectedProductView.name}
                  className="w-full h-full object-contain rounded-2xl"
                />
                <button
                  onClick={() => setSelectedProductView(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-baseline mb-2">
                  <h3 className="font-extrabold text-xl text-[#FFF5EB]">{selectedProductView.name}</h3>
                  <span className="text-2xl font-black text-[#E84A5F]">
                    S/. {selectedProductView.price.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs font-bold text-amber-400 mb-3">{selectedProductView.sizeDetail}</p>
                <p className="text-sm text-[#C4B2A7] leading-relaxed mb-6">{selectedProductView.description}</p>

                <button
                  onClick={() => {
                    setSelectedProductView(null);
                    setAppMode('delivery');
                    openCustomizer(selectedProductView);
                  }}
                  className="w-full bg-[#E84A5F] hover:bg-[#D43B50] text-white font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg"
                >
                  <ShoppingCart size={16} /> Pedir este Producto para Delivery
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ADMIN CONTROL PANEL */}
      <AnimatePresence>
        {isAdminOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1C100B] text-[#FFF5EB] rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-2xl border border-amber-500/30"
            >
              <div className="flex items-center justify-between pb-4 border-b border-stone-800 mb-6">
                <div className="flex items-center gap-2">
                  <Sliders className="text-amber-400" />
                  <h3 className="font-black text-lg text-amber-300">Panel de Control & Precios (Dueño)</h3>
                </div>
                <button
                  onClick={() => setIsAdminOpen(false)}
                  className="p-1 rounded-full bg-stone-800 text-stone-300 hover:bg-stone-700"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-stone-900/80 border border-stone-800 gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <img src={p.image} alt={p.name} className="w-12 h-12 rounded-xl object-cover" />
                      <div>
                        <p className="text-xs font-bold text-white">{p.name}</p>
                        <p className="text-[11px] text-stone-400">{p.sizeDetail}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-stone-400">S/.</span>
                        <input
                          type="number"
                          step="0.5"
                          value={p.price}
                          onChange={(e) => updatePrice(p.id, parseFloat(e.target.value) || 0)}
                          className="w-16 bg-stone-800 border border-stone-700 rounded-lg text-xs font-bold p-1.5 text-center text-amber-300 focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <button
                        onClick={() => toggleStock(p.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                          p.inStock ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                        }`}
                      >
                        {p.inStock ? 'Disponible' : 'Agotado'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-stone-800">
                <button
                  onClick={resetToDefault}
                  className="text-xs text-stone-400 hover:text-white flex items-center gap-1.5"
                >
                  <RefreshCw size={13} /> Restaurar Catálogo Original
                </button>
                <button
                  onClick={() => setIsAdminOpen(false)}
                  className="bg-amber-400 hover:bg-amber-300 text-[#2C1810] font-black text-xs px-5 py-2.5 rounded-xl"
                >
                  Guardar y Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AUTH MODAL */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1C100B] text-[#FFF5EB] border border-[#381F17] rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center"
            >
              <div className="w-12 h-12 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/30 mx-auto flex items-center justify-center mb-3">
                <Lock size={20} />
              </div>
              <h3 className="font-extrabold text-lg text-[#FFF5EB] mb-1">Acceso Administrativo</h3>
              <p className="text-xs text-[#A69085] mb-4">Ingresa el PIN de administrador para editar precios.</p>

              <form onSubmit={handleVerifyPassword}>
                <div className="relative mb-3">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Contraseña Admin"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full text-center text-lg tracking-widest font-black p-3 rounded-2xl border border-[#351C13] bg-[#24130C] text-[#FFF5EB] focus:outline-none focus:border-[#E84A5F]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3.5 text-stone-400 hover:text-stone-300"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {authError && <p className="text-xs text-red-400 font-bold mb-3">{authError}</p>}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAuthModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#2A160F] text-stone-300 hover:bg-[#381D14]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#E84A5F] text-white hover:bg-[#D43B50]"
                  >
                    Entrar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
