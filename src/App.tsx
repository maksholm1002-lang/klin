import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import Admin from './Admin'

// ---------- Типы ----------
type Product = {
  id: string; drop: string; name: string; category: string
  status: 'preorder' | 'soon' | 'available' | 'soldout' | 'draft'
  price: number; description: string; material: string; image: string
  photos?: string[]; colors?: string[]; shippingWindow?: string
  sizeChart?: SizeChartRow[]; sizeNotes?: string[]
  colorPhotos?: Record<string, string[]>
}
type SizeChartRow = { size: string; chest: number; halfChest: number; length: number; rusSize: string }
type SizeRule = { size: string; waist: [number, number]; hips: [number, number]; height: [number, number]; note: string }
type PickupPoint = { code: string; name: string; address: string; postalCode: string; workTime: string; phone: string; latitude?: number; longitude?: number }
type CartItem = { productId: string; name: string; image: string; size: string; color: string; qty: number; price: number }
type AccountOrder = Record<string, unknown>
type LeafletModule = typeof import('leaflet')
type LeafletRuntime = LeafletModule & { default?: LeafletModule }

const COLOR_HEX: Record<string, string> = { 'Чёрный': '#161616', 'Хаки': '#6b6a4b', 'Шоколадный': '#4a3424' }
const DELIVERY_OPTIONS = ['СДЭК', 'Почта России', 'Через менеджера']
const STATUS_LABEL: Record<Product['status'], string> = { preorder: 'Предзаказ', available: 'В наличии', soon: 'Скоро', soldout: 'Продано', draft: '' }
const LEGAL = [
  { id: 'public-offer', label: 'Публичная оферта' },
  { id: 'privacy-policy', label: 'Политика конфиденциальности' },
  { id: 'personal-data-consent', label: 'Согласие на обработку данных' },
  { id: 'delivery-payment', label: 'Доставка и оплата' },
  { id: 'returns-exchange', label: 'Возврат и обмен' },
]
const CIS_COUNTRIES = ['Россия', 'Беларусь', 'Казахстан', 'Армения', 'Азербайджан', 'Кыргызстан', 'Молдова', 'Таджикистан', 'Узбекистан']
const COUNTRIES = [...CIS_COUNTRIES, 'Грузия', 'Туркменистан', 'Украина', 'Латвия', 'Литва', 'Эстония', 'Германия', 'Польша', 'Чехия', 'Турция', 'ОАЭ', 'Израиль', 'США', 'Канада', 'Другая страна']
const isCisCountry = (c: string) => CIS_COUNTRIES.includes(c)
const deliveryOptionsFor = (c: string): string[] => c === 'Россия' ? DELIVERY_OPTIONS : isCisCountry(c) ? ['СДЭК', 'Через менеджера'] : ['Через менеджера']
const STATUS_RU: Record<string, string> = {
  new: 'Новый', paid: 'Оплачен', production: 'В производстве', сборка: 'В сборке',
  предзаказ: 'Предзаказ', ready: 'Готов к отправке', shipped: 'Отправлен', cancelled: 'Отменён',
}
const STATUS_STEPS = ['Оплачен', 'В сборке', 'Готов к отправке', 'Отправлен']
const statusRu = (s: string) => STATUS_RU[s] || s
const cdekTrackUrl = (t: string) => `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(t)}`
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const dolyamePart = (n: number) => Math.ceil(Math.max(0, n) / 4)
const FREE_SHIPPING_THRESHOLD = 8000
const TG = 'lin_asia'
const UTM_STORAGE = 'lin-utm'
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'https://linasia.ru').replace(/\/$/, '')
const assetUrl = (url?: string) => {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/.test(url)) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`
}
const normalizeProduct = (p: Product): Product => ({
  ...p,
  image: assetUrl(p.image),
  photos: p.photos?.map(assetUrl),
  colorPhotos: p.colorPhotos
    ? Object.fromEntries(Object.entries(p.colorPhotos).map(([color, photos]) => [color, photos.map(assetUrl)]))
    : undefined,
})
const normalizeReview = (rv: Record<string, unknown>) => ({
  ...rv,
  photoUrl: typeof rv.photoUrl === 'string' ? assetUrl(rv.photoUrl) : rv.photoUrl,
})
const safeStorage = {
  get(key: string) {
    try { return window.localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value) } catch { /* storage can be blocked on iOS */ }
  },
  remove(key: string) {
    try { window.localStorage.removeItem(key) } catch { /* storage can be blocked on iOS */ }
  },
}
async function fetchJson<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}
const createVisitorId = () => {
  try {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return uuid
  } catch { /* no-op */ }
  return String(Date.now()) + Math.random().toString(36).slice(2)
}
const currentUtm = () => {
  const params = new URLSearchParams(window.location.search)
  const hasUtm = ['utm_source', 'utm_medium', 'utm_campaign'].some((key) => params.has(key))
  if (hasUtm) {
    const utm = {
      utmSource: params.get('utm_source')?.slice(0, 80) || '',
      utmMedium: params.get('utm_medium')?.slice(0, 80) || '',
      utmCampaign: params.get('utm_campaign')?.slice(0, 120) || '',
    }
    safeStorage.set(UTM_STORAGE, JSON.stringify(utm))
    return utm
  }
  try {
    const saved = safeStorage.get(UTM_STORAGE)
    if (saved) return JSON.parse(saved) as { utmSource?: string; utmMedium?: string; utmCampaign?: string }
  } catch { /* ignore broken storage values */ }
  return { utmSource: '', utmMedium: '', utmCampaign: '' }
}

// ---------- Карта ПВЗ (leaflet) ----------
function markerIcon(leaflet: LeafletModule, active = false) {
  return leaflet.divIcon({ className: `pp-marker ${active ? 'active' : ''}`, html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] })
}
function PickupMap({ points, selected, onSelect }: { points: PickupPoint[]; selected: string; onSelect: (c: string) => void }) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<Array<{ code: string; marker: LeafletMarker }>>([])
  const [leaflet, setLeaflet] = useState<LeafletModule | null>(null)
  const located = useMemo(() => points.filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number'), [points])

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((module) => {
      if (!cancelled) setLeaflet((module as LeafletRuntime).default ?? module)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!leaflet || !elRef.current || mapRef.current) return
    const map = leaflet.map(elRef.current, { attributionControl: false, scrollWheelZoom: false }).setView([55.7558, 37.6173], 10)
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [leaflet])

  useEffect(() => {
    const map = mapRef.current
    if (!leaflet || !map) return
    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current = []
    if (!located.length) return
    const bounds = leaflet.latLngBounds([])
    located.forEach((p) => {
      const ll = leaflet.latLng(p.latitude as number, p.longitude as number)
      const marker = leaflet.marker(ll, { icon: markerIcon(leaflet, p.code === selected), title: `${p.name} · ${p.address}` })
      marker.on('click', () => onSelect(p.code))
      marker.addTo(map)
      markersRef.current.push({ code: p.code, marker })
      bounds.extend(ll)
    })
    if (bounds.isValid()) { map.fitBounds(bounds, { maxZoom: 13, padding: [22, 22] }); window.setTimeout(() => map.invalidateSize(), 0) }
  }, [leaflet, located, onSelect, selected])

  useEffect(() => {
    if (!leaflet) return
    markersRef.current.forEach(({ code, marker }) => marker.setIcon(markerIcon(leaflet, code === selected)))
  }, [leaflet, selected])

  return <div className="pp-map" ref={elRef}>{!leaflet && <p className="muted sm">Загружаем карту…</p>}</div>
}

function recommendTopSize(chart: SizeChartRow[], bodyChest: number): SizeChartRow | null {
  if (!chart || !chart.length || !bodyChest) return null
  const sorted = [...chart].sort((a, b) => a.chest - b.chest)
  for (const r of sorted) if (r.chest >= bodyChest) return r
  return sorted[sorted.length - 1]
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [sizes, setSizes] = useState<SizeRule[]>([])
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [catalogCategory, setCatalogCategory] = useState('ALL')
  const [view, setView] = useState<'home' | 'product' | 'reviews' | 'admin'>(() => (location.hash.includes('lin-admin') || location.pathname.includes('lin-admin')) ? 'admin' : 'home')
  const [activeId, setActiveId] = useState('')
  const [photoIdx, setPhotoIdx] = useState(0)
  const galleryTouch = useRef(0)
  const [chosenSize, setChosenSize] = useState('')
  const [chosenColor, setChosenColor] = useState('')
  const [sizeFinderOpen, setSizeFinderOpen] = useState(false)
  const [sfChest, setSfChest] = useState('')
  const [sfProduct, setSfProduct] = useState<Product | null>(null)
  const [heroImage, setHeroImage] = useState('')
  const [heroTitle, setHeroTitle] = useState('')

  // аккаунт
  const [userToken, setUserToken] = useState(() => safeStorage.get('lin-user-token') ?? '')
  const [userName, setUserName] = useState(() => safeStorage.get('lin-user-name') ?? '')
  const [userPhone, setUserPhone] = useState(() => safeStorage.get('lin-user-phone') ?? '')
  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authPhone, setAuthPhone] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authName, setAuthName] = useState('')
  const [authMsg, setAuthMsg] = useState('')
  const [accountOrders, setAccountOrders] = useState<AccountOrder[]>([])

  // оформление
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [form, setForm] = useState({ name: '', surname: '', phone: '', email: '', telegram: '', country: 'Россия', city: 'Москва', delivery: 'СДЭК' })
  const [reviewFor, setReviewFor] = useState<string>('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewText, setReviewText] = useState('')
  const [reviewPhoto, setReviewPhoto] = useState('')
  const [reviewMsg, setReviewMsg] = useState('')
  const [points, setPoints] = useState<PickupPoint[]>([])
  const [pointsLoading, setPointsLoading] = useState(false)
  const [pointSearch, setPointSearch] = useState('')
  const [cityOpts, setCityOpts] = useState<Array<{ city: string; region?: string; country?: string }>>([])
  const [cityFocus, setCityFocus] = useState(false)
  const [pickCode, setPickCode] = useState('')
  const [agree, setAgree] = useState(false)
  const [quote, setQuote] = useState<{ cost: number; label: string; originalCost?: number; freeShipping?: boolean } | null>(null)
  const [promo, setPromo] = useState('')
  const [promoState, setPromoState] = useState<{ valid: boolean; gift?: string; reason?: string } | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [orderMsg, setOrderMsg] = useState('')
  const [paymentLink, setPaymentLink] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'tochka' | 'dolyame'>('tochka')

  // legal / cookie
  const [legal, setLegal] = useState<{ label: string; text: string } | null>(null)
  const [cookieOk, setCookieOk] = useState(() => safeStorage.get('lin-cookie-ok') === '1')
  const [tgPrompt, setTgPrompt] = useState(() => safeStorage.get('lin-tg-prompt') !== 'closed')

  useEffect(() => {
    const syncAdminRoute = () => {
      if (location.hash.includes('lin-admin') || location.pathname.includes('lin-admin')) setView('admin')
    }
    syncAdminRoute()
    window.addEventListener('hashchange', syncAdminRoute)
    return () => window.removeEventListener('hashchange', syncAdminRoute)
  }, [])

  const active = useMemo(() => products.find((p) => p.id === activeId) ?? null, [products, activeId])
  const selectedPoint = useMemo(() => points.find((p) => p.code === pickCode) ?? null, [points, pickCode])
  const needPickup = form.delivery === 'СДЭК' || form.delivery === 'Почта России'
  const checkoutItems = cart
  const productTotal = useMemo(() => checkoutItems.reduce((sum, item) => sum + item.price * item.qty, 0), [checkoutItems])
  const cartQty = useMemo(() => checkoutItems.reduce((sum, item) => sum + item.qty, 0), [checkoutItems])
  const visiblePoints = useMemo(() => {
    const q = pointSearch.trim().toLowerCase()
    if (!q) return points
    return points.filter((p) => `${p.name} ${p.address} ${p.workTime}`.toLowerCase().includes(q))
  }, [points, pointSearch])

  useEffect(() => {
    void (async () => {
      const d = await fetchJson<{ products?: Product[]; sizes?: SizeRule[]; settings?: { hero?: { image?: string; title?: string } } }>('/api/bootstrap', 4500)
      if (!d) { setCatalogLoaded(true); return }
      setProducts(Array.isArray(d.products) ? d.products.filter((p: Product) => p.status !== 'draft').map(normalizeProduct) : [])
      setSizes(Array.isArray(d.sizes) ? d.sizes : [])
      setHeroImage(assetUrl(d.settings?.hero?.image ?? ''))
      setHeroTitle(d.settings?.hero?.title ?? '')
      setCatalogLoaded(true)
    })()
    void (async () => {
      const d = await fetchJson<Array<Record<string, unknown>>>('/api/reviews', 3500)
      setReviews(Array.isArray(d) ? d.map(normalizeReview) : [])
    })()
    window.setTimeout(() => {
      try {
        let vid = safeStorage.get('lin-visitor-id')
        if (!vid) { vid = (createVisitorId()); safeStorage.set('lin-visitor-id', vid) }
        fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ type: 'visit', visitorId: vid, path: `${location.pathname}${location.search}`, ...currentUtm() }) }).catch(() => {})
      } catch { /* no-op */ }
    }, 1600)
  }, [])

  function openProduct(p: Product) {
    setActiveId(p.id); setPhotoIdx(0); setChosenSize('')
    setChosenColor((p.colors && p.colors[0]) || '')
    setView('product'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function gallery(p: Product, color?: string): string[] {
    const cp = color && p.colorPhotos ? p.colorPhotos[color] : undefined
    if (cp && cp.length) return cp.filter(Boolean)
    const arr = (p.photos && p.photos.length ? p.photos : [p.image]).filter(Boolean)
    return arr.length ? arr : [p.image]
  }
  function productCover(p: Product): string {
    const color = p.colors?.[0]
    const colorPhotos = color && p.colorPhotos ? p.colorPhotos[color] : undefined
    return colorPhotos?.find(Boolean) || p.image
  }

  // legal
  async function openLegal(id: string, label: string) {
    setLegal({ label, text: 'Загрузка…' })
    try { const t = await (await fetch(`/legal/${id}.md`)).text(); setLegal({ label, text: t }) }
    catch { setLegal({ label, text: 'Не удалось загрузить документ.' }) }
  }

  // аккаунт
  async function submitAuth() {
    setAuthMsg('')
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: authPhone, password: authPassword, name: authName }) })
      const data = await r.json().catch(() => ({}) as Record<string, string>)
      if (!r.ok) { setAuthMsg(data.error || 'Не получилось'); return }
      setUserToken(data.token); setUserName(data.name || ''); setUserPhone(data.phone || '')
      safeStorage.set('lin-user-token', data.token); safeStorage.set('lin-user-name', data.name || ''); safeStorage.set('lin-user-phone', data.phone || '')
      setAuthOpen(false); setAuthPassword('')
      if (data.phone) setForm((f) => ({ ...f, phone: f.phone || data.phone }))
      if (data.name) setForm((f) => ({ ...f, name: f.name || data.name }))
    } catch { setAuthMsg('API недоступен. Попробуйте позже.') }
  }
  function logoutUser() {
    setUserToken(''); setUserName(''); setUserPhone(''); setAccountOpen(false); setAccountOrders([])
    safeStorage.remove('lin-user-token'); safeStorage.remove('lin-user-name'); safeStorage.remove('lin-user-phone')
  }
  async function openAccount() {
    if (!userToken) { setAuthMode('login'); setAuthMsg(''); setAuthOpen(true); return }
    setAccountOpen(true)
    try {
      const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${userToken}` } })
      if (r.ok) { const d = await r.json(); setAccountOrders(Array.isArray(d.orders) ? d.orders : []); if (d.name) setUserName(d.name) }
      else if (r.status === 401) { logoutUser(); setAuthMode('login'); setAuthOpen(true) }
    } catch { /* offline */ }
  }

  function uploadReviewPhoto(file: File) {
    if (file.size > 8 * 1024 * 1024) { setReviewMsg('Фото слишком большое (до 8 МБ)'); return }
    setReviewMsg('Загружаю фото…')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const r = await fetch('/api/reviews/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: String(reader.result) }) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setReviewMsg(d.error || 'Не удалось загрузить фото'); return }
        setReviewPhoto(d.url); setReviewMsg('')
      } catch { setReviewMsg('API недоступен') }
    }
    reader.readAsDataURL(file)
  }

  async function submitReview(orderId: string) {
    setReviewMsg('')
    if (reviewText.trim().length < 4) { setReviewMsg('Напиши пару слов'); return }
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, rating: reviewRating, text: reviewText.trim(), name: userName, photoUrl: reviewPhoto }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setReviewMsg(d.error === 'Review already exists for this order' ? 'Отзыв на этот заказ уже есть' : 'Не удалось отправить'); return }
      setReviewFor(''); setReviewText(''); setReviewRating(5); setReviewPhoto('')
      setReviewMsg('Спасибо! Отзыв появится после модерации.')
    } catch { setReviewMsg('API недоступен') }
  }

  // оформление
  function startCheckout() {
    if (!active) return
    if (sizes.length && !chosenSize) { setOrderMsg('Выбери размер'); return }
    const item: CartItem = {
      productId: active.id,
      name: active.name,
      image: gallery(active, chosenColor)[0] || active.image,
      size: chosenSize || '—',
      color: chosenColor,
      qty: 1,
      price: active.price,
    }
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.productId === item.productId && x.size === item.size && x.color === item.color)
      if (idx === -1) return [...prev, item]
      return prev.map((x, i) => i === idx ? { ...x, qty: Math.min(20, x.qty + 1) } : x)
    })
    try {
      const visitorId = safeStorage.get('lin-visitor-id') || ''
      if (visitorId) fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cart_add', visitorId, productId: active.id, path: `${location.pathname}${location.search}`, ...currentUtm() }) }).catch(() => {})
    } catch { /* no-op */ }
    setOrderMsg(''); setQuote(null); setPickCode(''); setPointSearch(''); setAgree(false); setCheckoutOpen(true)
  }
  function updateCartQty(i: number, qty: number) {
    setCart((prev) => prev.map((item, idx) => idx === i ? { ...item, qty: Math.min(20, Math.max(1, qty)) } : item))
  }
  function removeCartItem(i: number) {
    setCart((prev) => {
      const next = prev.filter((_, idx) => idx !== i)
      if (!next.length) setCheckoutOpen(false)
      return next
    })
  }

  // подгрузка ПВЗ при смене города/способа
  useEffect(() => {
    if (!checkoutOpen || !needPickup || form.city.trim().length < 2) { setPoints([]); return }
    let cancel = false
    setPointsLoading(true); setPickCode(''); setPointSearch('')
    const endpoint = form.delivery === 'СДЭК' ? '/api/cdek/pickup-points' : '/api/russian-post/pickup-points'
    const q = `city=${encodeURIComponent(form.city.trim())}&country=${encodeURIComponent(form.country)}`
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${endpoint}?${q}`)
        const d = await r.json()
        if (!cancel) setPoints(Array.isArray(d.points) ? d.points : [])
      } catch { if (!cancel) setPoints([]) }
      if (!cancel) setPointsLoading(false)
    }, 450)
    return () => { cancel = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOpen, form.city, form.delivery, form.country])

  // автоподсказка городов (СДЭК)
  useEffect(() => {
    if (!checkoutOpen || form.delivery === 'Через менеджера' || form.city.trim().length < 2) { setCityOpts([]); return }
    let cancel = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cdek/cities?city=${encodeURIComponent(form.city.trim())}&country=${encodeURIComponent(form.country)}`)
        const d = await r.json()
        if (!cancel) setCityOpts(Array.isArray(d.cities) ? d.cities.slice(0, 6) : [])
      } catch { if (!cancel) setCityOpts([]) }
    }, 350)
    return () => { cancel = true; clearTimeout(t) }
  }, [checkoutOpen, form.city, form.country, form.delivery])

  // оценка доставки
  useEffect(() => {
    if (!checkoutOpen || checkoutItems.length === 0) { setQuote(null); return }
    const t = setTimeout(async () => {
      try {
        const first = checkoutItems[0]
        const r = await fetch('/api/delivery/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            city: form.city, country: form.country, productId: first.productId, delivery: form.delivery,
            pickupPointCode: pickCode, pickupPointName: selectedPoint?.name ?? '', postalCode: selectedPoint?.postalCode ?? '',
            items: checkoutItems.map(({ productId, size, color, qty }) => ({ productId, size, color, qty })),
          }),
        })
        if (r.ok) { const d = await r.json(); setQuote({ cost: Number(d.cost ?? 0), label: String(d.label ?? form.delivery), originalCost: Number(d.originalCost ?? d.cost ?? 0), freeShipping: Boolean(d.freeShipping) }) }
        else setQuote(null)
      } catch { setQuote(null) }
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOpen, form.city, form.country, form.delivery, pickCode, selectedPoint?.code, checkoutItems])

  async function checkPromo() {
    const code = promo.trim()
    if (!code) { setPromoState(null); return }
    setPromoChecking(true)
    try {
      const r = await fetch('/api/promo/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      setPromoState(await r.json())
    } catch { setPromoState({ valid: false, reason: 'error' }) }
    finally { setPromoChecking(false) }
  }

  async function placeOrder() {
    if (checkoutItems.length === 0) { setOrderMsg('Корзина пустая'); return }
    setOrderMsg('')
    setPaymentLink('')
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (!form.name.trim()) return setOrderMsg('Укажи имя')
    if (phoneDigits.length < 7) return setOrderMsg('Укажи телефон с кодом страны')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setOrderMsg('Укажи корректный email')
    if (!form.city.trim()) return setOrderMsg('Укажи город')
    if (needPickup && !selectedPoint) return setOrderMsg('Выбери пункт выдачи на карте')
    if (!agree) return setOrderMsg('Подтверди согласие с офертой и обработкой данных')

    setPlacing(true)
    try {
      const first = checkoutItems[0]
      const r = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: [form.surname.trim(), form.name.trim()].filter(Boolean).join(' '),
          city: form.city.trim(), country: form.country,
          address: selectedPoint?.address ?? '',
          pickupPointCode: selectedPoint?.code ?? '', pickupPointName: selectedPoint?.name ?? '', postalCode: selectedPoint?.postalCode ?? '',
          phone: form.phone.trim(), email: form.email.trim().toLowerCase(), telegram: form.telegram.trim(),
          productId: first.productId, size: first.size || '—', color: first.color, delivery: form.delivery,
          items: checkoutItems.map(({ productId, size, color, qty }) => ({ productId, size: size || '—', color, qty })),
          paymentMethod,
          promoCode: promoState?.valid ? promo.trim() : '',
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setOrderMsg(data.error || 'Не удалось создать заказ. Напиши менеджеру.'); setPlacing(false); return }
      const nextPaymentLink = typeof data.paymentUrl === 'string' ? data.paymentUrl.trim() : ''
      if (nextPaymentLink) {
        setPaymentLink(nextPaymentLink)
        setOrderMsg('Заказ создан. Если оплата не открылась автоматически, нажми кнопку ниже.')
        setPlacing(false)
        try {
          window.location.assign(nextPaymentLink)
        } catch {
          // The visible payment link below is the fallback for strict mobile webviews.
        }
        return
      }
      setOrderMsg('Заказ создан! Менеджер свяжется в Telegram.')
    } catch { setOrderMsg('API недоступен. Попробуй ещё раз.') }
    setPlacing(false)
  }

  const heroProduct = useMemo(() => {
    const activeProducts = products.filter((p) => p.status !== 'soldout' && p.status !== 'draft' && p.image)
    return activeProducts.find((p) => p.status === 'available')
      ?? activeProducts.find((p) => p.status === 'preorder')
      ?? activeProducts.find((p) => p.status === 'soon')
      ?? products.find((p) => p.image)
      ?? null
  }, [products])
  const heroSrc = heroImage || (heroProduct ? productCover(heroProduct) : '')
  const heroCta = heroProduct?.status === 'available' ? 'В наличии' : heroProduct?.status === 'preorder' ? 'Предзаказ' : 'К товару'
  const catalogCategories = useMemo(() => [
    { id: 'ALL', label: 'ВСЕ' },
    { id: 'TOPS', label: 'ВЕРХ' },
    { id: 'PANTS', label: 'НИЗ' },
    { id: 'SOLD OUT', label: 'РАСПРОДАНО' },
  ], [])
  const catalogProducts = useMemo(() => products.filter((p) => {
    if (catalogCategory === 'SOLD OUT') return p.status === 'soldout'
    if (catalogCategory === 'TOPS') return /top|топ/i.test(`${p.name} ${p.category}`)
    if (catalogCategory === 'PANTS') return /pants|trouser|штан|брюк|хакама/i.test(`${p.name} ${p.category}`)
    return true
  }), [catalogCategory, products])
  const freeShippingLeft = Math.max(0, FREE_SHIPPING_THRESHOLD - productTotal)
  const displayDeliveryCost = productTotal >= FREE_SHIPPING_THRESHOLD && quote ? 0 : (quote?.cost ?? 0)
  const sfChart = sfProduct?.sizeChart ?? []
  const sfResult = useMemo(() => recommendTopSize(sfChart, Number(sfChest) || 0), [sfChart, sfChest])
  const openSizeFinder = (p: Product | null) => { setSfProduct(p); setSfChest(''); setSizeFinderOpen(true) }
  const colorList = active?.colors ?? []
  const modelNote = active?.sizeNotes?.find((note) => /На модели размер/i.test(note)) ?? ''

  // ====================================================
  if (view === 'admin') return <Admin />

  return (
    <div className="lin">
      <header className="hd">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setView('home'); window.scrollTo({ top: 0 }) }}>
          <span className="hanzi">林</span><span className="word">LIN</span>
        </a>
        <nav className="nav">
          <a href="#catalog" onClick={(e) => { e.preventDefault(); setView('home'); window.scrollTo({ top: 0 }) }}>Каталог</a>
          <a href="#reviews" onClick={(e) => { e.preventDefault(); setView('reviews'); window.scrollTo({ top: 0 }) }}>Отзывы</a>
          <a href={`https://t.me/${TG}`} target="_blank" rel="noreferrer">Telegram</a>
        </nav>
        <button className="acc-btn" onClick={openAccount} type="button">{userToken ? (userName ? userName.split(' ')[0] : 'Кабинет') : 'Войти'}</button>
      </header>

      {view === 'home' ? (
        <>
          <section className="catalog" id="catalog">
            <div className="catalog-tabs" aria-label="Категории каталога">
              {catalogCategories.map((cat) => (
                <button key={cat.id} className={catalogCategory === cat.id ? 'on' : ''} type="button" onClick={() => setCatalogCategory(cat.id)}>
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="sec-head"><h2>Каталог</h2><span>{products.filter((p) => p.status !== 'soldout').length} в наличии · {products.filter((p) => p.status === 'soldout').length} sold out</span></div>
            <div className="grid">
              {catalogProducts.map((p) => (
                <button className={`card ${p.status === 'soldout' ? 'soldout-card' : ''}`} key={p.id} onClick={() => openProduct(p)} type="button">
                  <div className="card-img">
                    <img src={productCover(p)} alt={p.name} decoding="async" loading="eager" />
                    {p.status === 'soldout' ? <span className="soldout-overlay">SOLD OUT</span> : null}
                    {STATUS_LABEL[p.status] && <span className={`badge st-${p.status}`}>{STATUS_LABEL[p.status]}</span>}
                  </div>
                  <div className="card-meta">
                    <div><div className="card-name">{p.name}</div><div className="card-sub">{p.drop}</div></div>
                    <div className="card-price">{p.price > 0 ? money(p.price) : 'скоро'}</div>
                  </div>
                  {p.price > 0 && <div className="card-dolyame">Долями по {money(dolyamePart(p.price))}</div>}
                  {p.price > 0 && <div className="card-shipping">Бесплатная доставка от {money(FREE_SHIPPING_THRESHOLD)}</div>}
                </button>
              ))}
              {!catalogProducts.length && <p className="muted">{catalogLoaded ? 'Каталог временно недоступен.' : 'Загружаем…'}</p>}
            </div>
          </section>
        </>
      ) : view === 'reviews' ? (
        <section className="reviews-page">
          <div className="sec-head"><h2>Отзывы</h2><span>{reviews.length}</span></div>
          <div className="reviews-wrap">
            {reviews.length === 0 ? (
              <p className="muted" style={{ padding: '0 28px' }}>Пока нет отзывов. Оставить отзыв можно в личном кабинете после покупки.</p>
            ) : (
              <div className="reviews-list">
                {reviews.map((rv, i) => (
                  <div className="review" key={String(rv.id ?? i)}>
                    <div className="rv-stars">{'★'.repeat(Math.max(1, Math.min(5, Number(rv.rating) || 5)))}<span>{'★'.repeat(5 - Math.max(1, Math.min(5, Number(rv.rating) || 5)))}</span></div>
                    <p className="rv-text">{String(rv.text ?? '')}</p>
                    {rv.photoUrl ? <img className="rv-img" src={String(rv.photoUrl)} alt="" decoding="async" loading="lazy" /> : null}
                    <div className="rv-author">{String(rv.name || rv.clientName || 'Покупатель')}{rv.place ? `, ${rv.place}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : active ? (
        <section className="product">
          <button className="back" onClick={() => setView('home')} type="button">← Каталог</button>
          <div className="product-grid">
            <div className="p-gallery">
              <div
                className="p-main"
                onTouchStart={(e) => { galleryTouch.current = e.touches[0].clientX }}
                onTouchEnd={(e) => {
                  const imgs = gallery(active, chosenColor)
                  if (imgs.length < 2) return
                  const dx = e.changedTouches[0].clientX - galleryTouch.current
                  if (dx < -40) setPhotoIdx((i) => (i + 1) % imgs.length)
                  else if (dx > 40) setPhotoIdx((i) => (i - 1 + imgs.length) % imgs.length)
                }}
              >
                <img src={gallery(active, chosenColor)[photoIdx] ?? gallery(active, chosenColor)[0]} alt={active.name} decoding="async" fetchPriority="high" />
                {gallery(active, chosenColor).length > 1 && (
                  <>
                    <button className="p-arrow left" type="button" aria-label="Назад" onClick={() => { const imgs = gallery(active, chosenColor); setPhotoIdx((i) => (i - 1 + imgs.length) % imgs.length) }}>‹</button>
                    <button className="p-arrow right" type="button" aria-label="Вперёд" onClick={() => { const imgs = gallery(active, chosenColor); setPhotoIdx((i) => (i + 1) % imgs.length) }}>›</button>
                    <div className="p-dots">{gallery(active, chosenColor).map((_, i) => <span key={i} className={i === photoIdx ? 'on' : ''} />)}</div>
                  </>
                )}
              </div>
              {gallery(active, chosenColor).length > 1 && <div className="p-thumbs">{gallery(active, chosenColor).map((src, i) => <button key={src + i} className={i === photoIdx ? 'on' : ''} onClick={() => setPhotoIdx(i)} type="button"><img src={src} alt="" decoding="async" loading="lazy" /></button>)}</div>}
            </div>
            <div className="p-info">
              <div className="p-drop">{active.drop}</div>
              <h1 className="p-name">{active.name}</h1>
              <div className="p-price">{active.price > 0 ? money(active.price) : 'Цена скоро'}</div>
              {active.price > 0 && <div className="dolyame-note">Долями: 4 платежа по {money(dolyamePart(active.price))}</div>}
              <p className="p-desc">{active.description}</p>
              {modelNote && <div className="p-model-note">{modelNote}</div>}

              {active.status === 'preorder' && (
                <div className="p-preorder">
                  <div className="p-preorder-t">📦 Предзаказ</div>
                  <div className="p-preorder-s">Изготовление 1–2 недели · лимитированная партия 200 шт</div>
                </div>
              )}

              {colorList.length > 0 && (
                <div className="p-block">
                  <div className="p-label">Цвет — <em>{chosenColor}</em></div>
                  <div className="swatches">{colorList.map((c) => <button key={c} type="button" title={c} className={`swatch ${chosenColor === c ? 'on' : ''}`} style={{ background: COLOR_HEX[c] || '#999' }} onClick={() => { setChosenColor(c); setPhotoIdx(0) }} />)}</div>
                </div>
              )}

              {sizes.length > 0 && (
                <div className="p-block">
                  <div className="p-label">Размер{chosenSize ? <em> — {chosenSize}</em> : ''}</div>
                  <div className="size-pills">{sizes.map((s) => <button key={s.size} type="button" className={`pill ${chosenSize === s.size ? 'on' : ''}`} onClick={() => setChosenSize(s.size)}>{s.size}</button>)}</div>
                  {(active.sizeChart?.length ?? 0) > 0 && <button className="size-help-link" type="button" onClick={() => openSizeFinder(active)}>📐 Подобрать размер</button>}
                </div>
              )}

              {active.material && (
                <div className="p-section">
                  <div className="p-label">Состав и детали</div>
                  <p className="p-text">{active.material}</p>
                </div>
              )}
              {active.shippingWindow && <div className="p-meta-row"><span>Отправка</span><span>{active.shippingWindow}</span></div>}
              <div className="p-meta-row free-ship"><span>Доставка</span><span>Бесплатно от {money(FREE_SHIPPING_THRESHOLD)}</span></div>

              {active.status === 'soldout' ? <button className="btn lg" disabled type="button">Продано</button>
                : active.price > 0 ? <button className="btn primary lg" onClick={startCheckout} type="button">Добавить в заказ · {money(active.price)}</button>
                : <a className="btn lg" href={`https://t.me/${TG}`} target="_blank" rel="noreferrer">Написать о наличии</a>}
              {orderMsg && !checkoutOpen && <div className="hint err">{orderMsg}</div>}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="ft">
        <div className="ft-brand"><span className="hanzi">林</span> LIN</div>
        <div className="ft-links">
          {LEGAL.map((d) => <a key={d.id} href={`/legal/${d.id}.md`} onClick={(e) => { e.preventDefault(); openLegal(d.id, d.label) }}>{d.label}</a>)}
          <a href={`https://t.me/${TG}`} target="_blank" rel="noreferrer">Telegram</a>
        </div>
        <div className="ft-copy">© {new Date().getFullYear()} LIN</div>
      </footer>

      {tgPrompt && cookieOk && (
        <div className="tg-prompt">
          <button className="tg-prompt-x" type="button" aria-label="Закрыть" onClick={() => { safeStorage.set('lin-tg-prompt', 'closed'); setTgPrompt(false) }}>✕</button>
          <div>
            <b>LIN в Telegram</b>
            <span>Анонсы дропов, наличие размеров и быстрые ответы.</span>
          </div>
          <a className="btn sm primary" href={`https://t.me/${TG}`} target="_blank" rel="noreferrer">Подписаться</a>
        </div>
      )}

      {/* Оформление */}
      {checkoutOpen && checkoutItems.length > 0 && (
        <div className="modal" onClick={() => setCheckoutOpen(false)}>
          <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><strong>Оформление</strong><button onClick={() => setCheckoutOpen(false)} type="button">✕</button></div>
            <div className="sheet-sum multi">
              <div className="cart-title"><span>В заказе</span><b>{cartQty} шт.</b></div>
              {checkoutItems.map((item, i) => (
                <div className="ss-row" key={`${item.productId}-${item.size}-${item.color}-${i}`}>
                  <img src={item.image} alt="" decoding="async" loading="lazy" />
                  <div><div className="ss-name">{item.name}</div><div className="ss-sub">{[item.color, item.size].filter(Boolean).join(' · ')}</div></div>
                  <div className="ss-qty"><button type="button" onClick={() => updateCartQty(i, item.qty - 1)}>−</button><span>{item.qty}</span><button type="button" onClick={() => updateCartQty(i, item.qty + 1)}>+</button></div>
                  <div className="ss-price">{money(item.price * item.qty)}</div>
                  <button className="ss-remove" type="button" onClick={() => removeCartItem(i)} aria-label="Убрать позицию">×</button>
                </div>
              ))}
              <button className="btn ghost sm" type="button" onClick={() => setCheckoutOpen(false)}>Добавить ещё товар</button>
            </div>
            <div className="fields">
              <div className="two"><input placeholder="Имя" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="Фамилия" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} /></div>
              <input placeholder="Телефон" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input placeholder="Email (для чека)" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input placeholder="Telegram" value={form.telegram} onChange={(e) => setForm({ ...form, telegram: e.target.value })} />
              <div className="two">
                <select value={form.country} onChange={(e) => {
                  const country = e.target.value
                  const opts = deliveryOptionsFor(country)
                  const delivery = isCisCountry(country)
                    ? (form.delivery !== 'Через менеджера' && opts.includes(form.delivery) ? form.delivery : 'СДЭК')
                    : 'Через менеджера'
                  setForm({ ...form, country, delivery, city: country === 'Россия' ? form.city : '' })
                  setCityOpts([]); setPickCode('')
                }}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <select value={form.delivery} onChange={(e) => setForm({ ...form, delivery: e.target.value })} disabled={deliveryOptionsFor(form.country).length === 1}>{deliveryOptionsFor(form.country).map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </div>
              {!isCisCountry(form.country) && <div className="muted sm" style={{ marginTop: 6 }}>Доставка в {form.country} оформляется через менеджера: после заказа с вами свяжутся, рассчитают стоимость и выставят счёт.</div>}
              {isCisCountry(form.country) && form.country !== 'Россия' && <div className="muted sm" style={{ marginTop: 6 }}>Доставка СДЭК в {form.country}: впишите свой город (например, Алматы, Минск) и выберите пункт выдачи.</div>}
              <div className="city-field">
                <input placeholder="Город" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} onFocus={() => setCityFocus(true)} onBlur={() => window.setTimeout(() => setCityFocus(false), 150)} />
                {cityFocus && cityOpts.length > 0 && (
                  <div className="city-drop">
                    {cityOpts.map((c, i) => (
                      <button key={i} type="button" onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, city: c.city }); setCityOpts([]); setCityFocus(false) }}>
                        <b>{c.city}</b>{c.region ? `, ${c.region}` : ''}{c.country ? ` · ${c.country}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {needPickup && (
              <div className="pickup">
                <div className="p-label" style={{ margin: '16px 0 10px' }}>Пункт выдачи {form.delivery} {pointsLoading ? '· загрузка…' : `· ${visiblePoints.length}/${points.length}`}</div>
                <PickupMap points={visiblePoints} selected={pickCode} onSelect={setPickCode} />
                <input className="pp-search" placeholder="Поиск ПВЗ по адресу" value={pointSearch} onChange={(e) => setPointSearch(e.target.value)} />
                {selectedPoint ? <div className="pp-chosen">✓ {selectedPoint.name}<br /><span>{selectedPoint.address} · {selectedPoint.workTime}</span></div>
                  : <div className="muted sm" style={{ marginTop: 8 }}>Кликни точку на карте. Поиск поможет отфильтровать адреса.</div>}
                {visiblePoints.length > 0 && (
                  <div className="pp-list">{visiblePoints.slice(0, 30).map((p) => <button key={p.code} type="button" className={`pp-item ${p.code === pickCode ? 'on' : ''}`} onClick={() => setPickCode(p.code)}><b>{p.address}</b><span>{p.workTime}</span></button>)}</div>
                )}
              </div>
            )}

            <div className="promo-block">
              <div className="promo-row">
                <input placeholder="Промокод (если есть)" value={promo} onChange={(e) => { setPromo(e.target.value.toUpperCase()); setPromoState(null) }} onBlur={checkPromo} />
                <button type="button" className="btn ghost sm" onClick={checkPromo} disabled={promoChecking || !promo.trim()}>{promoChecking ? '…' : 'Применить'}</button>
              </div>
              {promoState && (promoState.valid
                ? <div className="promo-ok">🎁 Промокод принят — {promoState.gift || 'подарок в посылке'}</div>
                : <div className="promo-err">{promoState.reason === 'used' ? 'Промокод уже использован' : promoState.reason === 'not_found' ? 'Промокод не найден' : 'Не удалось проверить'}</div>)}
            </div>

            <div className="totals">
              <div><span>Товары</span><span>{money(productTotal)}</span></div>
              <div><span>Доставка</span><span>{quote ? (displayDeliveryCost ? money(displayDeliveryCost) : 'бесплатно') : '—'}</span></div>
              {productTotal > 0 && productTotal < FREE_SHIPPING_THRESHOLD && <div className="ship-left"><span>До бесплатной доставки</span><span>{money(freeShippingLeft)}</span></div>}
              {productTotal >= FREE_SHIPPING_THRESHOLD && <div className="ship-left ok"><span>Бесплатная доставка</span><span>применена</span></div>}
              <div className="grand"><span>Итого</span><span>{money(productTotal + displayDeliveryCost)}</span></div>
            </div>
            <div className="pay-methods">
              <button className={paymentMethod === 'tochka' ? 'on' : ''} type="button" onClick={() => setPaymentMethod('tochka')}>
                <strong>Карта / СБП / T-Pay</strong>
                <span>Оплата через Точку</span>
              </button>
              <button className={paymentMethod === 'dolyame' ? 'on' : ''} type="button" onClick={() => setPaymentMethod('dolyame')}>
                <strong>Долями</strong>
                <span>4 платежа по {money(dolyamePart(productTotal + (quote?.cost ?? 0)))}</span>
              </button>
            </div>
            <label className="agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>Я принимаю <a href="/legal/public-offer.md" onClick={(e) => { e.preventDefault(); openLegal('public-offer', 'Публичная оферта') }}>оферту</a> и согласен на <a href="/legal/personal-data-consent.md" onClick={(e) => { e.preventDefault(); openLegal('personal-data-consent', 'Согласие на обработку данных') }}>обработку данных</a>.</span></label>
            {orderMsg && <div className={`hint ${paymentLink ? '' : 'err'}`}>{orderMsg}</div>}
            {paymentLink && <a className="btn primary lg full pay-fallback" href={paymentLink} rel="noopener noreferrer">Открыть оплату</a>}
            <button className="btn primary lg full" disabled={placing} onClick={placeOrder} type="button">{placing ? 'Создаём…' : 'Перейти к оплате'}</button>
            <p className="fine">Чек придёт на email, трек — после отправки.</p>
          </div>
        </div>
      )}

      {/* Вход / Кабинет */}
      {(authOpen || accountOpen) && (
        <div className="modal" onClick={() => { setAuthOpen(false); setAccountOpen(false) }}>
          <div className="sheet narrow" onClick={(e) => e.stopPropagation()}>
            {accountOpen ? (
              <>
                <div className="sheet-head"><strong>Личный кабинет</strong><button onClick={() => setAccountOpen(false)} type="button">✕</button></div>
                <p className="muted">{userName || 'Покупатель'}{userPhone ? ` · ${userPhone}` : ''}</p>
                <h4 className="mini-h">Мои заказы</h4>
                {accountOrders.length === 0 ? <p className="muted">Заказов по вашему номеру пока нет.</p> : (
                  <div className="orders">{accountOrders.map((o) => {
                    const id = String(o.id ?? '')
                    const track = String(o.track ?? '')
                    const hasTrack = Boolean(track) && !track.startsWith('ожидает') && track !== 'через менеджера'
                    const status = String(o.status ?? '')
                    const ruStatus = statusRu(status)
                    const stepIdx = STATUS_STEPS.indexOf(ruStatus)
                    const paid = o.paymentStatus === 'paid' || o.paymentStatus === 'manager'
                    const isCdek = o.deliveryProvider === 'cdek'
                    return (
                      <div className="order" key={id}>
                        <div className="o-top"><b>{String(o.product ?? '')}</b><span>{money(Number(o.total ?? 0))}</span></div>
                        <div className="o-sub">{[o.color, o.size].filter(Boolean).join(' · ')}{o.delivery ? ` · ${o.delivery}` : ''}</div>
                        <div className="o-status"><span className="o-badge">{ruStatus}</span></div>
                        {stepIdx >= 0 && (
                          <div className="o-steps">{STATUS_STEPS.map((s, i) => <span key={s} className={i <= stepIdx ? 'done' : ''}>{s}</span>)}</div>
                        )}
                        {hasTrack ? (
                          <div className="o-track">Трек: <b>{track}</b>{isCdek && <> · <a href={cdekTrackUrl(track)} target="_blank" rel="noreferrer">отследить</a></>}</div>
                        ) : paid ? <div className="o-track muted">Трек появится после отправки</div> : null}
                        <div className="o-actions">
                          {o.paymentStatus === 'pending' && o.paymentUrl ? <a className="btn sm" href={String(o.paymentUrl)} target="_blank" rel="noreferrer">Оплатить</a> : null}
                          {paid && o.paymentUrl ? <a className="btn ghost sm" href={String(o.paymentUrl)} target="_blank" rel="noreferrer">🧾 Чек</a> : null}
                          {paid && reviewFor !== id ? <button className="btn ghost sm" type="button" onClick={() => { setReviewFor(id); setReviewMsg(''); setReviewText(''); setReviewRating(5); setReviewPhoto('') }}>Оставить отзыв</button> : null}
                        </div>
                        {reviewFor === id && (
                          <div className="rv-form">
                            <div className="rv-pick">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= reviewRating ? 'on' : ''} onClick={() => setReviewRating(n)}>★</button>)}</div>
                            <textarea placeholder="Ваш отзыв…" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
                            <div className="rv-photo-row">
                              {reviewPhoto ? (
                                <div className="rv-photo-prev"><img src={reviewPhoto} alt="" decoding="async" loading="lazy" /><button type="button" onClick={() => setReviewPhoto('')}>✕</button></div>
                              ) : (
                                <label className="rv-photo-add">📷 Добавить фото<input type="file" accept="image/*" hidden onChange={(e) => e.target.files && e.target.files[0] && uploadReviewPhoto(e.target.files[0])} /></label>
                              )}
                            </div>
                            {reviewMsg && <div className="hint">{reviewMsg}</div>}
                            <div className="two"><button className="btn primary sm" type="button" onClick={() => submitReview(id)}>Отправить</button><button className="btn ghost sm" type="button" onClick={() => { setReviewFor(''); setReviewPhoto('') }}>Отмена</button></div>
                          </div>
                        )}
                      </div>
                    )
                  })}</div>
                )}
                {reviewMsg && reviewFor === '' && <div className="hint" style={{ marginTop: 8 }}>{reviewMsg}</div>}
                <button className="btn ghost full" onClick={logoutUser} type="button">Выйти</button>
              </>
            ) : (
              <>
                <div className="sheet-head"><strong>{authMode === 'login' ? 'Вход' : 'Регистрация'}</strong><button onClick={() => setAuthOpen(false)} type="button">✕</button></div>
                <div className="fields">
                  {authMode === 'register' && <input placeholder="Имя" value={authName} onChange={(e) => setAuthName(e.target.value)} />}
                  <input placeholder="Телефон" inputMode="tel" value={authPhone} onChange={(e) => setAuthPhone(e.target.value)} />
                  <input placeholder="Пароль" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                  {authMsg && <div className="hint err">{authMsg}</div>}
                  <button className="btn primary full" onClick={submitAuth} type="button">{authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
                  <button className="btn ghost full" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthMsg('') }} type="button">{authMode === 'login' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Legal */}
      {legal && (
        <div className="modal" onClick={() => setLegal(null)}>
          <div className="sheet wide legal" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><strong>{legal.label}</strong><button onClick={() => setLegal(null)} type="button">✕</button></div>
            <pre className="legal-text">{legal.text}</pre>
          </div>
        </div>
      )}

      {/* Подбор размера */}
      {sizeFinderOpen && sfProduct && (
        <div className="modal" onClick={() => setSizeFinderOpen(false)}>
          <div className="sheet narrow" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><strong>Подбор размера</strong><button onClick={() => setSizeFinderOpen(false)} type="button">✕</button></div>
            <p className="sf-hint">Измерьте обхват груди в самой широкой точке — подберём размер.</p>
            <label className="sf-one">Обхват груди, см
              <input type="number" inputMode="numeric" value={sfChest} onChange={(e) => setSfChest(e.target.value)} placeholder="напр. 90" autoFocus />
            </label>
            {sfChest && sfResult && (
              <div className="sf-result">
                <div className="sf-size">{sfResult.size}</div>
                <div className="sf-note">Российский размер {sfResult.rusSize} · обхват изделия {sfResult.chest} см</div>
              </div>
            )}
            {sfProduct.sizeChart && sfProduct.sizeChart.length > 0 && (
              <>
                <div className="sf-divider">🖤 В таблице — размеры готового изделия. В списке ниже — ваши мерки по телу, по которым выбираете размер.</div>
                <table className="sf-table">
                  <thead><tr><th>Размер</th><th>Грудь изделия</th><th>½ обхв.</th><th>Длина</th><th>Рос.</th></tr></thead>
                  <tbody>{sfProduct.sizeChart.map((r) => (
                    <tr key={r.size} className={sfResult?.size === r.size ? 'on' : ''}>
                      <td><b>{r.size}</b></td><td>{r.chest}</td><td>{r.halfChest}</td><td>{r.length}</td><td>{r.rusSize}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <div className="sf-bodyrange">🖤 Ваш обхват груди (по телу) — ориентир для выбора: XS — 78–84 см; S — 85–90 см; M — 91–96 см; L — 97–102 см.</div>
              </>
            )}
            {sfProduct.sizeNotes && sfProduct.sizeNotes.length > 0 && (
              <ul className="sf-notes">{sfProduct.sizeNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
            <button className="btn primary full" type="button" onClick={() => { const sz = sfResult?.size; setSizeFinderOpen(false); openProduct(sfProduct); if (sz) setChosenSize(sz) }}>
              {sfChest && sfResult ? `К товару · размер ${sfResult.size}` : 'К товару'}
            </button>
          </div>
        </div>
      )}

      {/* Cookie */}
      {!cookieOk && (
        <div className="cookie">
          <span>Мы используем cookie для работы сайта. Оставаясь, вы соглашаетесь с <a href="/legal/privacy-policy.md" onClick={(e) => { e.preventDefault(); openLegal('privacy-policy', 'Политика конфиденциальности') }}>политикой</a>.</span>
          <button className="btn sm" onClick={() => { safeStorage.set('lin-cookie-ok', '1'); setCookieOk(true) }} type="button">Принять</button>
        </div>
      )}
    </div>
  )
}
