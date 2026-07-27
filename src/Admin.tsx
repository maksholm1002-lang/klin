import { useEffect, useMemo, useState } from 'react'
import './App.css'

type AnyRec = Record<string, any>
type SizeChartRow = { size: string; chest: number; halfChest: number; length: number; rusSize: string }
type DropExpense = { id: string; name: string; amount: number; note?: string; createdAt: string }
type DropFinanceConfig = { unitCost?: number; acquiringRate?: number; expenses?: DropExpense[] }
type DropFinanceState = Record<string, DropFinanceConfig>
const PRODUCT_STATUS: [string, string][] = [['preorder', 'Предзаказ'], ['available', 'В наличии'], ['soon', 'Скоро'], ['soldout', 'Продано'], ['draft', 'Черновик']]
const ORDER_STATUS: [string, string][] = [['new', 'Новый'], ['paid', 'Оплачен'], ['production', 'В производстве'], ['ready', 'Готов к отправке'], ['shipped', 'Отправлен'], ['cancelled', 'Отменён']]
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const isPaid = (o: AnyRec) => o.paymentStatus === 'paid' || o.paymentStatus === 'manager'
const paymentProvider = (o: AnyRec) => {
  const url = String(o.paymentUrl ?? '')
  if (url.includes('dolyame')) return 'Долями'
  if (url.includes('tochka') || url.includes('enter.tochka') || url.includes('payment-link')) return 'Точка'
  if (o.paymentStatus === 'manager') return 'Менеджер'
  const events = Array.isArray(o.integrationEvents) ? o.integrationEvents : []
  if (events.some((e: AnyRec) => e.service === 'dolyame')) return 'Долями'
  if (events.some((e: AnyRec) => e.service === 'tochka')) return 'Точка'
  return 'оплата'
}
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const TAX_RATE = 4
const DEFAULT_ACQUIRING_RATE = 2.7
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'https://linasia.ru').replace(/\/$/, '')
const apiUrl = (url: string) => /^(https?:|data:|blob:)/.test(url) ? url : `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`
const SITE_URL = 'https://www.linasia.ru/'
const UTM_LINKS = [
  { name: 'TikTok', url: `${SITE_URL}?utm_source=tiktok&utm_medium=social&utm_campaign=drop02_top` },
  { name: 'Trends', url: `${SITE_URL}?utm_source=trends&utm_medium=social&utm_campaign=drop02_top` },
  { name: 'Instagram', url: `${SITE_URL}?utm_source=instagram&utm_medium=social&utm_campaign=drop02_top` },
]

export default function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem('lin-admin-token') ?? '')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'dash' | 'finance' | 'products' | 'orders' | 'reviews' | 'promo'>('dash')
  const [promos, setPromos] = useState<AnyRec[]>([])
  const [promoCount, setPromoCount] = useState('20')
  const [promoGift, setPromoGift] = useState('Подарок в посылке')
  const [products, setProducts] = useState<AnyRec[]>([])
  const [orders, setOrders] = useState<AnyRec[]>([])
  const [reviews, setReviews] = useState<AnyRec[]>([])
  const [summary, setSummary] = useState<AnyRec | null>(null)
  const [heroImage, setHeroImage] = useState('')
  const [heroTitle, setHeroTitle] = useState('')
  const [dropFinance, setDropFinance] = useState<DropFinanceState>({})
  const [expenseDraft, setExpenseDraft] = useState<Record<string, { name: string; amount: string; note: string }>>({})
  const [orderSort, setOrderSort] = useState('new')
  const [orderStatusF, setOrderStatusF] = useState('active')
  const [orderPayF, setOrderPayF] = useState('all')
  const [orderPromoF, setOrderPromoF] = useState('all')
  const [orderQ, setOrderQ] = useState('')
  const [reconciling, setReconciling] = useState(false)
  const [dragPhoto, setDragPhoto] = useState<{ productId: string; url: string; color?: string } | null>(null)
  const [msg, setMsg] = useState('')

  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })

  async function login() {
    setErr('')
    try {
      const r = await fetch(apiUrl('/api/admin/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) })
      if (!r.ok) { setErr('Неверный телефон или пароль'); return }
      const d = await r.json(); setToken(d.token); localStorage.setItem('lin-admin-token', d.token)
    } catch { setErr('API недоступен') }
  }
  function logout() { setToken(''); localStorage.removeItem('lin-admin-token') }

  async function load() {
    try {
      const r = await fetch(apiUrl('/api/admin/bootstrap'), { headers: headers() })
      if (r.status === 401) { logout(); return }
      const d = await r.json()
      setProducts(Array.isArray(d.products) ? d.products : [])
      setOrders(Array.isArray(d.orders) ? d.orders.slice().reverse() : [])
      setSummary(d.analyticsSummary ?? null)
      setHeroImage(d.settings?.hero?.image ?? '')
      setHeroTitle(d.settings?.hero?.title ?? '')
      setDropFinance((d.siteConfig?.dropFinance ?? {}) as DropFinanceState)
      const rr = await fetch(apiUrl('/api/admin/reviews'), { headers: headers() })
      if (rr.ok) setReviews(await rr.json())
      const pr = await fetch(apiUrl('/api/admin/promo'), { headers: headers() })
      if (pr.ok) setPromos(await pr.json())
    } catch { /* */ }
  }
  async function generatePromo() {
    const count = Math.max(1, Math.min(1000, Number(promoCount) || 1))
    setMsg('Генерирую промокоды…')
    const r = await fetch(apiUrl('/api/admin/promo/generate'), { method: 'POST', headers: headers(), body: JSON.stringify({ count, gift: promoGift.trim() || 'Подарок в посылке' }) })
    setMsg(r.ok ? `✓ Создано ${count} промокодов` : '✗ Ошибка'); void load()
  }
  async function deletePromo(code: string) {
    await fetch(apiUrl(`/api/admin/promo/${encodeURIComponent(code)}`), { method: 'DELETE', headers: headers() }); void load()
  }
  async function saveHero(patch: { image?: string; title?: string }) {
    await fetch(apiUrl('/api/settings/hero'), { method: 'PUT', headers: headers(), body: JSON.stringify(patch) })
  }
  function uploadHero(file: File) {
    setMsg('Загружаю фото главного экрана…')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const r = await fetch(apiUrl('/api/uploads'), { method: 'POST', headers: headers(), body: JSON.stringify({ dataUrl: String(reader.result), filename: file.name }) })
        if (!r.ok) { setMsg('✗ Ошибка загрузки'); return }
        const { url } = await r.json()
        setHeroImage(url)
        await saveHero({ image: url })
        setMsg('✓ Фото главного экрана обновлено')
      } catch { setMsg('✗ API недоступен') }
    }
    reader.readAsDataURL(file)
  }
  useEffect(() => { if (token) void load() }, [token])

  // ---- метрики дашборда ----
  const stats = useMemo(() => {
    const paid = orders.filter(isPaid)
    const revenue = paid.reduce((s, o) => s + (Number(o.total) || 0), 0)
    const pending = orders.filter((o) => o.paymentStatus === 'pending').length
    const byStatus = new Map<string, number>()
    const byProduct = new Map<string, { count: number; revenue: number; sizes: Map<string, number>; cities: Map<string, number> }>()
    for (const o of orders) {
      byStatus.set(String(o.status), (byStatus.get(String(o.status)) || 0) + 1)
      const cur = byProduct.get(String(o.product)) || { count: 0, revenue: 0, sizes: new Map(), cities: new Map() }
      cur.count++; if (isPaid(o)) cur.revenue += Number(o.total) || 0
      const sz = String(o.size || '—'); cur.sizes.set(sz, (cur.sizes.get(sz) || 0) + 1)
      const ct = String(o.city || '—'); cur.cities.set(ct, (cur.cities.get(ct) || 0) + 1)
      byProduct.set(String(o.product), cur)
    }
    const top = [...byProduct.entries()].map(([name, v]) => ({
      name, count: v.count, revenue: v.revenue,
      sizes: [...v.sizes.entries()].sort((a, b) => b[1] - a[1]),
      cities: [...v.cities.entries()].sort((a, b) => b[1] - a[1]),
    })).sort((a, b) => b.count - a.count)
    return { total: orders.length, paidCount: paid.length, revenue, avg: paid.length ? revenue / paid.length : 0, pending, byStatus: [...byStatus.entries()], top }
  }, [orders])

  const dropStats = useMemo(() => {
    const productById = new Map(products.map((p) => [String(p.id), p]))
    const drops = new Map<string, {
      drop: string
      products: Set<string>
      orders: Set<string>
      paidOrders: Set<string>
      units: number
      revenue: number
      sizes: Map<string, number>
      colors: Map<string, number>
    }>()
    const ensureDrop = (drop: string) => {
      const key = drop || 'Без дропа'
      let current = drops.get(key)
      if (!current) {
        current = { drop: key, products: new Set(), orders: new Set(), paidOrders: new Set(), units: 0, revenue: 0, sizes: new Map(), colors: new Map() }
        drops.set(key, current)
      }
      return current
    }
    for (const p of products) ensureDrop(String(p.drop || 'Без дропа')).products.add(String(p.name || p.id))
    for (const order of orders) {
      const paid = isPaid(order)
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ productId: order.productId, productName: order.product, size: order.size, color: order.color, qty: 1, price: Number(order.productTotal || order.total || 0) }]
      const orderDrops = new Set<string>()
      for (const item of items) {
        const product = productById.get(String(item.productId))
        const drop = String(product?.drop || 'Без дропа')
        const row = ensureDrop(drop)
        const qty = Math.max(1, Number(item.qty) || 1)
        row.products.add(String(product?.name || item.productName || order.product || 'Товар'))
        row.units += paid ? qty : 0
        row.revenue += paid ? (Number(item.price) || 0) * qty : 0
        const size = String(item.size || order.size || '—')
        const color = String(item.color || order.color || '—')
        row.sizes.set(size, (row.sizes.get(size) || 0) + qty)
        row.colors.set(color, (row.colors.get(color) || 0) + qty)
        orderDrops.add(drop)
      }
      for (const drop of orderDrops) {
        const row = ensureDrop(drop)
        row.orders.add(String(order.id))
        if (paid) row.paidOrders.add(String(order.id))
      }
    }
    return [...drops.values()].map((row) => {
      const cfg = dropFinance[row.drop] ?? {}
      const unitCost = Number(cfg.unitCost) || 0
      const acquiringRate = cfg.acquiringRate == null ? DEFAULT_ACQUIRING_RATE : Number(cfg.acquiringRate) || 0
      const expenses = Array.isArray(cfg.expenses) ? cfg.expenses : []
      const manualExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      const cogs = unitCost * row.units
      const tax = row.revenue * TAX_RATE / 100
      const acquiring = row.revenue * acquiringRate / 100
      const profit = row.revenue - cogs - manualExpenses - tax - acquiring
      return {
        ...row,
        products: [...row.products],
        orderCount: row.orders.size,
        paidOrderCount: row.paidOrders.size,
        unitCost,
        acquiringRate,
        expenses,
        manualExpenses,
        cogs,
        tax,
        acquiring,
        profit,
        profitPerUnit: row.units ? profit / row.units : 0,
        margin: row.revenue ? (profit / row.revenue) * 100 : 0,
        sizes: [...row.sizes.entries()].sort((a, b) => b[1] - a[1]),
        colors: [...row.colors.entries()].sort((a, b) => b[1] - a[1]),
      }
    }).sort((a, b) => b.revenue - a.revenue || b.units - a.units)
  }, [dropFinance, orders, products])

  const financeTotals = useMemo(() => {
    return dropStats.reduce((sum, drop) => ({
      revenue: sum.revenue + drop.revenue,
      units: sum.units + drop.units,
      orderCount: sum.orderCount + drop.orderCount,
      paidOrderCount: sum.paidOrderCount + drop.paidOrderCount,
      cogs: sum.cogs + drop.cogs,
      manualExpenses: sum.manualExpenses + drop.manualExpenses,
      tax: sum.tax + drop.tax,
      acquiring: sum.acquiring + drop.acquiring,
      profit: sum.profit + drop.profit,
    }), { revenue: 0, units: 0, orderCount: 0, paidOrderCount: 0, cogs: 0, manualExpenses: 0, tax: 0, acquiring: 0, profit: 0 })
  }, [dropStats])

  function patchDropFinance(drop: string, patch: Partial<DropFinanceConfig>) {
    setDropFinance((current) => ({ ...current, [drop]: { ...(current[drop] ?? {}), ...patch } }))
  }
  async function saveDropFinance(next = dropFinance) {
    setMsg('Сохраняю финансы…')
    const r = await fetch(apiUrl('/api/config'), { method: 'PUT', headers: headers(), body: JSON.stringify({ dropFinance: next }) })
    setMsg(r.ok ? '✓ Финансы сохранены' : '✗ Ошибка сохранения финансов')
    if (r.ok) void load()
  }
  async function addDropExpense(drop: string) {
    const draft = expenseDraft[drop] ?? { name: '', amount: '', note: '' }
    const amount = Number(String(draft.amount).replace(',', '.')) || 0
    if (!draft.name.trim() || amount <= 0) { setMsg('Укажи название и сумму расхода'); return }
    const expenses = [...(dropFinance[drop]?.expenses ?? []), { id: newId(), name: draft.name.trim(), amount, note: draft.note.trim(), createdAt: new Date().toISOString() }]
    const next = { ...dropFinance, [drop]: { ...(dropFinance[drop] ?? {}), expenses } }
    setDropFinance(next)
    setExpenseDraft((cur) => ({ ...cur, [drop]: { name: '', amount: '', note: '' } }))
    await saveDropFinance(next)
  }
  async function removeDropExpense(drop: string, id: string) {
    const expenses = (dropFinance[drop]?.expenses ?? []).filter((e) => e.id !== id)
    const next = { ...dropFinance, [drop]: { ...(dropFinance[drop] ?? {}), expenses } }
    setDropFinance(next)
    await saveDropFinance(next)
  }

  // ---- продукты ----
  function patchLocal(id: string, field: string, value: unknown) { setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p))) }
  async function saveProduct(p: AnyRec) {
    setMsg('Сохраняю…')
    try {
      const r = await fetch(apiUrl(`/api/products/${p.id}`), { method: 'PATCH', headers: headers(), body: JSON.stringify({ name: p.name, price: Number(p.price) || 0, status: p.status, description: p.description, material: p.material, colors: p.colors ?? [], image: p.image, photos: p.photos ?? [], sizeChart: p.sizeChart ?? [], sizeNotes: p.sizeNotes ?? [], colorPhotos: p.colorPhotos ?? {} }) })
      setMsg(r.ok ? `✓ Сохранено: ${p.name}` : '✗ Ошибка сохранения'); if (r.ok) void load()
    } catch { setMsg('✗ API недоступен') }
  }
  function updateSizeRow(p: AnyRec, i: number, field: keyof SizeChartRow, value: string) {
    const chart: SizeChartRow[] = [...((p.sizeChart as SizeChartRow[] | undefined) ?? [])]
    const isText = field === 'size' || field === 'rusSize'
    chart[i] = { ...chart[i], [field]: isText ? value : (Number(value) || 0) }
    patchLocal(p.id, 'sizeChart', chart)
  }
  function addSizeRow(p: AnyRec) {
    const chart: SizeChartRow[] = [...((p.sizeChart as SizeChartRow[] | undefined) ?? []), { size: '', chest: 0, halfChest: 0, length: 0, rusSize: '' }]
    patchLocal(p.id, 'sizeChart', chart)
  }
  function removeSizeRow(p: AnyRec, i: number) {
    const chart = ((p.sizeChart as SizeChartRow[] | undefined) ?? []).filter((_, idx) => idx !== i)
    patchLocal(p.id, 'sizeChart', chart)
  }
  function uploadPhoto(p: AnyRec, file: File) {
    setMsg('Загружаю фото…')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const r = await fetch(apiUrl('/api/uploads'), { method: 'POST', headers: headers(), body: JSON.stringify({ dataUrl: String(reader.result), filename: file.name }) })
        if (!r.ok) { setMsg('✗ Ошибка загрузки'); return }
        const { url } = await r.json()
        setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, image: url, photos: [...(x.photos ?? []), url] } : x)))
        setMsg('✓ Фото загружено — нажми «Сохранить»')
      } catch { setMsg('✗ API недоступен') }
    }
    reader.readAsDataURL(file)
  }
  function removePhoto(p: AnyRec, url: string) {
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, photos: (x.photos ?? []).filter((u: string) => u !== url), image: x.image === url ? ((x.photos ?? []).filter((u: string) => u !== url)[0] ?? '') : x.image } : x)))
  }
  function uploadColorPhoto(p: AnyRec, color: string, file: File) {
    setMsg(`Загружаю фото для «${color}»…`)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const r = await fetch(apiUrl('/api/uploads'), { method: 'POST', headers: headers(), body: JSON.stringify({ dataUrl: String(reader.result), filename: file.name }) })
        if (!r.ok) { setMsg('✗ Ошибка загрузки'); return }
        const { url } = await r.json()
        setProducts((ps) => ps.map((x) => {
          if (x.id !== p.id) return x
          const cp = { ...(x.colorPhotos ?? {}) }
          cp[color] = [...(cp[color] ?? []), url]
          return { ...x, colorPhotos: cp }
        }))
        setMsg('✓ Фото добавлено к цвету — нажми «Сохранить»')
      } catch { setMsg('✗ API недоступен') }
    }
    reader.readAsDataURL(file)
  }
  function removeColorPhoto(p: AnyRec, color: string, url: string) {
    setProducts((ps) => ps.map((x) => {
      if (x.id !== p.id) return x
      const cp = { ...(x.colorPhotos ?? {}) }
      cp[color] = (cp[color] ?? []).filter((u: string) => u !== url)
      return { ...x, colorPhotos: cp }
    }))
  }
  function reorderPhoto(p: AnyRec, targetUrl: string, color?: string) {
    if (!dragPhoto || dragPhoto.productId !== p.id || dragPhoto.color !== color || dragPhoto.url === targetUrl) return
    setProducts((ps) => ps.map((x) => {
      if (x.id !== p.id) return x
      const current = color
        ? [ ...(((x.colorPhotos ?? {})[color] as string[] | undefined) ?? []) ]
        : [ ...((((x.photos as string[] | undefined) ?? []).length ? (x.photos as string[]) : [x.image]).filter(Boolean)) ]
      const from = current.indexOf(dragPhoto.url)
      const to = current.indexOf(targetUrl)
      if (from < 0 || to < 0) return x
      const nextPhotos = [...current]
      const [moved] = nextPhotos.splice(from, 1)
      nextPhotos.splice(to, 0, moved)
      if (color) {
        const cp = { ...(x.colorPhotos ?? {}), [color]: nextPhotos }
        const isFirstColor = color === ((x.colors ?? [])[0] ?? '')
        return { ...x, colorPhotos: cp, ...(isFirstColor ? { image: nextPhotos[0], photos: nextPhotos } : {}) }
      }
      return { ...x, photos: nextPhotos, image: nextPhotos[0] ?? x.image }
    }))
    setDragPhoto(null)
    setMsg('✓ Порядок фото изменён — нажми «Сохранить»')
  }

  // ---- заказы ----
  async function patchOrder(id: string, body: AnyRec) { await fetch(apiUrl(`/api/orders/${id}`), { method: 'PATCH', headers: headers(), body: JSON.stringify(body) }); void load() }
  async function deleteOrder(id: string) {
    if (!window.confirm('Удалить заказ навсегда? Действие необратимо.')) return
    setMsg('Удаляю заказ…')
    await fetch(apiUrl(`/api/orders/${id}`), { method: 'DELETE', headers: headers() })
    setMsg('✓ Заказ удалён'); void load()
  }
  async function reconcileOrders() {
    setReconciling(true); setMsg('Сверяю оплаты с Точкой…')
    try {
      const r = await fetch(apiUrl('/api/admin/reconcile'), { method: 'POST', headers: headers() })
      const d = await r.json()
      setMsg(r.ok ? `✓ Сверка: подтверждено оплат +${d.paid}, удалено неоплаченных ${d.deleted}` : '✗ Ошибка сверки')
      void load()
    } catch { setMsg('✗ API недоступен') } finally { setReconciling(false) }
  }
  const sortedOrders = useMemo(() => {
    let arr = [...orders]
    if (orderPayF === 'paid') arr = arr.filter(isPaid)
    else if (orderPayF === 'unpaid') arr = arr.filter((o) => !isPaid(o))
    if (orderPromoF === 'promo') arr = arr.filter((o) => {
      const orderPromo = String(o.promoCode ?? '').trim()
      return Boolean(orderPromo || promos.some((p) => p.usedByOrder === o.id))
    })
    else if (orderPromoF === 'nopromo') arr = arr.filter((o) => {
      const orderPromo = String(o.promoCode ?? '').trim()
      return !orderPromo && !promos.some((p) => p.usedByOrder === o.id)
    })
    if (orderStatusF === 'active') arr = arr.filter((o) => !['shipped', 'cancelled'].includes(String(o.status)))
    else if (orderStatusF !== 'all') arr = arr.filter((o) => String(o.status) === orderStatusF)
    const q = orderQ.trim().toLowerCase()
    if (q) arr = arr.filter((o) => [o.id, o.client, o.phone, o.product, o.city, o.promoCode, o.promoGift].some((v) => String(v ?? '').toLowerCase().includes(q)))
    switch (orderSort) {
      case 'old': return arr.reverse()
      case 'unpaid': return arr.sort((a, b) => (isPaid(a) ? 1 : 0) - (isPaid(b) ? 1 : 0))
      case 'paid': return arr.sort((a, b) => (isPaid(b) ? 1 : 0) - (isPaid(a) ? 1 : 0))
      case 'amount': return arr.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
      default: return arr
    }
  }, [orders, promos, orderSort, orderPayF, orderPromoF, orderStatusF, orderQ])
  const promoByOrder = useMemo(() => {
    const map = new Map<string, AnyRec>()
    for (const promo of promos) {
      if (promo.usedByOrder) map.set(String(promo.usedByOrder), promo)
    }
    return map
  }, [promos])
  const ordersWithPromo = useMemo(() => orders.filter((o) => String(o.promoCode ?? '').trim() || promoByOrder.has(String(o.id))).length, [orders, promoByOrder])
  async function markPaid(id: string) { setMsg('Отмечаю оплату…'); await patchOrder(id, { paymentStatus: 'paid' }); setMsg('✓ Заказ отмечен оплаченным') }
  async function createShipment(id: string) {
    setMsg('Создаю отправление СДЭК…')
    try {
      const r = await fetch(apiUrl(`/api/orders/${id}/create-shipment`), { method: 'POST', headers: headers() })
      const d = await r.json().catch(() => ({}))
      setMsg(r.ok ? `✓ Отправление создано, трек: ${d.track || '—'}` : `✗ ${d.error || 'Ошибка СДЭК'}`); void load()
    } catch { setMsg('✗ API недоступен') }
  }
  async function sendTrack(id: string) { const r = await fetch(apiUrl(`/api/orders/${id}/send-track`), { method: 'POST', headers: headers() }); setMsg(r.ok ? '✓ Трек отправлен клиенту' : '✗ Ошибка') }
  async function approveReview(id: string) { await fetch(apiUrl(`/api/admin/reviews/${id}/approve`), { method: 'POST', headers: headers() }); void load() }
  async function deleteReview(id: string) { await fetch(apiUrl(`/api/admin/reviews/${id}`), { method: 'DELETE', headers: headers() }); void load() }

  if (!token) {
    return (
      <div className="adm-login">
        <div className="adm-login-box">
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 20 }}><span className="hanzi">林</span><span className="word">LIN · АДМИН</span></div>
          <div className="fields">
            <input placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input placeholder="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
            {err && <div className="hint err">{err}</div>}
            <button className="btn primary full" onClick={login} type="button">Войти</button>
          </div>
        </div>
      </div>
    )
  }

  const periods = summary?.periods as Record<string, AnyRec> | undefined

  return (
    <div className="adm">
      <header className="adm-head">
        <div className="brand"><span className="hanzi">林</span><span className="word">LIN · АДМИН</span></div>
        <div className="adm-tabs">
          {([['dash', 'Дашборд'], ['finance', 'Финансы'], ['products', `Товары (${products.length})`], ['orders', `Заказы (${orders.length})`], ['reviews', `Отзывы (${reviews.length})`], ['promo', `Промокоды (${promos.length})`]] as [typeof tab, string][]).map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} type="button">{label}</button>
          ))}
        </div>
        <div className="adm-right"><a href="/" className="adm-link">↗ Сайт</a><button className="adm-link" onClick={logout} type="button">Выйти</button></div>
      </header>

      {msg && <div className="adm-msg" onClick={() => setMsg('')}>{msg} <span>✕</span></div>}

      <div className="adm-body">
        {tab === 'dash' && (
          <>
            <div className="adm-card adm-hero" style={{ marginBottom: 16 }}>
              <h3 className="dash-h">Главный экран (hero)</h3>
              <div className="adm-hero-row">
                <div className="adm-hero-prev">{heroImage ? <img src={heroImage} alt="hero" /> : <span className="muted">Фото не задано — показывается фото товара</span>}</div>
                <div className="adm-hero-ctl">
                  <label className="adm-upload">{heroImage ? 'Заменить фото' : 'Загрузить фото'}<input type="file" accept="image/*" hidden onChange={(e) => e.target.files && e.target.files[0] && uploadHero(e.target.files[0])} /></label>
                  {heroImage && <button type="button" className="btn ghost sm" onClick={async () => { setHeroImage(''); await saveHero({ image: '' }); setMsg('✓ Фото убрано — снова показывается фото товара') }}>Убрать фото</button>}
                  <label className="adm-f"><span>Заголовок (пусто = название товара)</span><input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} onBlur={() => saveHero({ title: heroTitle })} placeholder="Silent Wrath Top" /></label>
                </div>
              </div>
            </div>
            <div className="dash-grid">
              <div className="dash-card"><div className="dash-num">{stats.total}</div><div className="dash-label">Заказов всего</div></div>
              <div className="dash-card hl"><div className="dash-num">{money(stats.revenue)}</div><div className="dash-label">Выручка (оплачено)</div></div>
              <div className="dash-card"><div className="dash-num">{stats.paidCount}</div><div className="dash-label">Оплачено</div></div>
              <div className="dash-card"><div className="dash-num">{money(stats.avg)}</div><div className="dash-label">Средний чек</div></div>
              <div className="dash-card"><div className="dash-num">{stats.pending}</div><div className="dash-label">Ждут оплаты</div></div>
            </div>

            {periods && (
              <div className="adm-card" style={{ marginTop: 16 }}>
                <h3 className="dash-h">Посещаемость сайта</h3>
                <div className="dash-grid">
                  {['day', 'week', 'month'].map((k) => {
                    const pd = periods[k]
                    return pd ? <div className="dash-card" key={k}><div className="dash-num">{pd.visitors ?? 0}</div><div className="dash-label">Уникальных · {pd.label ?? k}</div></div> : null
                  })}
                  <div className="dash-card"><div className="dash-num">{periods.week?.visits ?? 0}</div><div className="dash-label">Заходов · 7 дней</div></div>
                  {summary?.conversionToday != null && <div className="dash-card"><div className="dash-num">{summary.conversionToday}%</div><div className="dash-label">Конверсия сегодня</div></div>}
                </div>
              </div>
            )}

            <div className="adm-card" style={{ marginTop: 16 }}>
              <h3 className="dash-h">UTM-ссылки для рекламы</h3>
              <div className="utm-links">
                {UTM_LINKS.map((link) => (
                  <a className="utm-link" key={link.name} href={link.url} target="_blank" rel="noreferrer">
                    <b>{link.name}</b>
                    <span>{link.url}</span>
                  </a>
                ))}
              </div>
            </div>

            {periods?.week?.sources && (
              <div className="adm-card" style={{ marginTop: 16 }}>
                <h3 className="dash-h">Источники по UTM · 7 дней</h3>
                <div className="source-row head"><div>Источник</div><div>Люди</div><div>Заходы</div><div>Корзина</div></div>
                {periods.week.sources.length === 0 ? <p className="muted">Пока нет UTM-переходов.</p> : periods.week.sources.map((row: AnyRec, i: number) => (
                  <div className="source-row" key={`${row.source}-${row.campaign}-${i}`}>
                    <div><b>{row.source || 'direct'}</b>{row.campaign ? <span>{row.campaign}</span> : null}</div>
                    <div>{row.visitors ?? 0}</div>
                    <div>{row.visits ?? 0}</div>
                    <div>{row.cartAdds ?? 0}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="adm-card" style={{ marginTop: 16 }}>
              <h3 className="dash-h">Заказы по товарам — что и где заказали</h3>
              {stats.top.length === 0 ? <p className="muted">Нет данных</p> : stats.top.map((p) => (
                <div className="dash-prod" key={p.name}>
                  <div className="dash-prod-h"><b>{p.name}</b><span>{p.count} зак. · {money(p.revenue)}</span></div>
                  <div className="dash-prod-sub"><span className="dash-prod-lbl">Размеры:</span> {p.sizes.map(([s, n]) => `${s} × ${n}`).join('   ') || '—'}</div>
                  <div className="dash-prod-sub"><span className="dash-prod-lbl">Города:</span> {p.cities.slice(0, 7).map(([c, n]) => `${c} × ${n}`).join('   ') || '—'}</div>
                </div>
              ))}
            </div>
            <div className="adm-card" style={{ marginTop: 16 }}>
              <h3 className="dash-h">Заказы по статусам</h3>
              {stats.byStatus.map(([s, n]) => <div className="dash-row" key={s}><span>{s}</span><span>{n}</span></div>)}
            </div>
          </>
        )}

        {tab === 'finance' && (
          <div className="adm-finance">
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <h3 className="dash-h">Финансы по дропам</h3>
              <div className="dash-grid">
                <div className="dash-card hl"><div className="dash-num">{money(financeTotals.revenue)}</div><div className="dash-label">Выручка по товарам</div></div>
                <div className="dash-card"><div className="dash-num">{financeTotals.units}</div><div className="dash-label">Продано единиц</div></div>
                <div className="dash-card"><div className="dash-num">{financeTotals.paidOrderCount}</div><div className="dash-label">Оплаченных заказов</div></div>
                <div className="dash-card"><div className="dash-num">{money(financeTotals.cogs)}</div><div className="dash-label">Себестоимость</div></div>
                <div className="dash-card"><div className="dash-num">{money(financeTotals.manualExpenses)}</div><div className="dash-label">Доп. расходы</div></div>
                <div className="dash-card"><div className="dash-num">{money(financeTotals.tax)}</div><div className="dash-label">Налог 4%</div></div>
                <div className="dash-card"><div className="dash-num">{money(financeTotals.acquiring)}</div><div className="dash-label">Эквайринг</div></div>
                <div className="dash-card hl"><div className="dash-num">{money(financeTotals.profit)}</div><div className="dash-label">Прибыль общая</div></div>
              </div>
              <p className="muted sm" style={{ marginTop: 10 }}>Считаем только оплаченные заказы и заказы через менеджера. Доставка не входит в выручку дропа. Налог считается как 4% от выручки.</p>
            </div>

            {dropStats.length === 0 ? <p className="muted">Нет дропов для расчета.</p> : dropStats.map((drop) => {
              const draft = expenseDraft[drop.drop] ?? { name: '', amount: '', note: '' }
              return (
                <div className="adm-card drop-fin" key={drop.drop}>
                  <div className="drop-fin-head">
                    <div>
                      <h3>{drop.drop}</h3>
                      <p>{drop.products.join(' · ') || 'Товары не указаны'}</p>
                    </div>
                    <div className={`drop-profit ${drop.profit >= 0 ? 'ok' : 'bad'}`}>{money(drop.profit)}</div>
                  </div>

                  <div className="drop-metrics">
                    <div><span>Заказы</span><b>{drop.orderCount}</b></div>
                    <div><span>Оплачено</span><b>{drop.paidOrderCount}</b></div>
                    <div><span>Единиц</span><b>{drop.units}</b></div>
                    <div><span>Выручка</span><b>{money(drop.revenue)}</b></div>
                    <div><span>Себес.</span><b>{money(drop.cogs)}</b></div>
                    <div><span>Расходы</span><b>{money(drop.manualExpenses)}</b></div>
                    <div><span>Налог 4%</span><b>{money(drop.tax)}</b></div>
                    <div><span>Эквайринг {drop.acquiringRate}%</span><b>{money(drop.acquiring)}</b></div>
                    <div><span>Прибыль / ед.</span><b>{money(drop.profitPerUnit)}</b></div>
                    <div><span>Маржа</span><b>{Math.round(drop.margin)}%</b></div>
                  </div>

                  <div className="drop-fin-controls">
                    <label className="adm-f"><span>Себестоимость 1 единицы, ₽</span><input type="number" value={dropFinance[drop.drop]?.unitCost ?? ''} onChange={(e) => patchDropFinance(drop.drop, { unitCost: Number(e.target.value) || 0 })} onBlur={() => saveDropFinance()} placeholder="0" /></label>
                    <label className="adm-f"><span>Эквайринг, %</span><input type="number" step="0.1" value={dropFinance[drop.drop]?.acquiringRate ?? DEFAULT_ACQUIRING_RATE} onChange={(e) => patchDropFinance(drop.drop, { acquiringRate: Number(e.target.value) || 0 })} onBlur={() => saveDropFinance()} placeholder={String(DEFAULT_ACQUIRING_RATE)} /></label>
                    <button className="btn ghost sm" type="button" onClick={() => saveDropFinance()}>Сохранить расчет</button>
                  </div>

                  <div className="drop-breakdown">
                    <div><span>Размеры:</span> {drop.sizes.map(([s, n]) => `${s} × ${n}`).join('   ') || '—'}</div>
                    <div><span>Цвета:</span> {drop.colors.map(([c, n]) => `${c} × ${n}`).join('   ') || '—'}</div>
                  </div>

                  <div className="drop-expenses">
                    <h4>Расходы дропа</h4>
                    {(drop.expenses ?? []).length === 0 ? <p className="muted sm">Расходов пока нет.</p> : (
                      <div className="drop-exp-list">
                        {drop.expenses.map((expense) => (
                          <div className="drop-exp" key={expense.id}>
                            <div><b>{expense.name}</b>{expense.note ? <span>{expense.note}</span> : null}</div>
                            <strong>{money(Number(expense.amount) || 0)}</strong>
                            <button type="button" onClick={() => removeDropExpense(drop.drop, expense.id)}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="drop-exp-add">
                      <input placeholder="Расход: ткань, пошив, съемка…" value={draft.name} onChange={(e) => setExpenseDraft((cur) => ({ ...cur, [drop.drop]: { ...draft, name: e.target.value } }))} />
                      <input placeholder="Сумма ₽" inputMode="decimal" value={draft.amount} onChange={(e) => setExpenseDraft((cur) => ({ ...cur, [drop.drop]: { ...draft, amount: e.target.value } }))} />
                      <input placeholder="Комментарий" value={draft.note} onChange={(e) => setExpenseDraft((cur) => ({ ...cur, [drop.drop]: { ...draft, note: e.target.value } }))} />
                      <button className="btn primary sm" type="button" onClick={() => addDropExpense(drop.drop)}>Добавить</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'products' && (
          <div className="adm-grid">
            {products.map((p) => (
              <div className="adm-card" key={p.id}>
                <div className="adm-photos">
                  {(p.photos && p.photos.length ? p.photos : [p.image]).filter(Boolean).map((u: string) => (
                    <div
                      className={`adm-photo ${u === p.image ? 'main' : ''}`}
                      key={u}
                      draggable
                      onClick={() => patchLocal(p.id, 'image', u)}
                      onDragStart={() => setDragPhoto({ productId: p.id, url: u })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); reorderPhoto(p, u) }}
                      title="Перетащите фото в начало или нажмите, чтобы сделать главным"
                    >
                      <img src={u} alt="" />
                      {u === p.image && <span className="adm-photo-main">★</span>}
                      <button type="button" className="adm-photo-x" onClick={(e) => { e.stopPropagation(); removePhoto(p, u) }}>✕</button>
                    </div>
                  ))}
                  <label className="adm-upload">+ фото<input type="file" accept="image/*" hidden onChange={(e) => e.target.files && e.target.files[0] && uploadPhoto(p, e.target.files[0])} /></label>
                </div>
                <div className="adm-photo-hint">Перетащите фото в нужный порядок: первое станет главным · можно просто нажать на фото · ★ — текущее главное</div>
                <div className="adm-prod-id">{p.id}</div>
                <label className="adm-f"><span>Название</span><input value={p.name ?? ''} onChange={(e) => patchLocal(p.id, 'name', e.target.value)} /></label>
                <div className="adm-row2">
                  <label className="adm-f"><span>Цена ₽</span><input type="number" value={p.price ?? 0} onChange={(e) => patchLocal(p.id, 'price', e.target.value)} /></label>
                  <label className="adm-f"><span>Статус</span><select value={p.status} onChange={(e) => patchLocal(p.id, 'status', e.target.value)}>{PRODUCT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                <label className="adm-f"><span>Цвета (через запятую)</span><input value={(p.colors ?? []).join(', ')} onChange={(e) => patchLocal(p.id, 'colors', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} /></label>
                <label className="adm-f"><span>Описание</span><textarea value={p.description ?? ''} onChange={(e) => patchLocal(p.id, 'description', e.target.value)} /></label>
                <label className="adm-f"><span>Состав / детали</span><textarea value={p.material ?? ''} onChange={(e) => patchLocal(p.id, 'material', e.target.value)} /></label>

                <div className="adm-sc">
                  <span className="adm-sc-title">Размерная сетка (помощник подбора)</span>
                  <div className="adm-sc-head"><span>Размер</span><span>Грудь</span><span>½ обхв.</span><span>Длина</span><span>Рос.</span><span></span></div>
                  {((p.sizeChart as SizeChartRow[] | undefined) ?? []).map((row, i) => (
                    <div className="adm-sc-row" key={i}>
                      <input value={row.size} onChange={(e) => updateSizeRow(p, i, 'size', e.target.value)} placeholder="M" />
                      <input type="number" value={row.chest || ''} onChange={(e) => updateSizeRow(p, i, 'chest', e.target.value)} placeholder="104" />
                      <input type="number" value={row.halfChest || ''} onChange={(e) => updateSizeRow(p, i, 'halfChest', e.target.value)} placeholder="52" />
                      <input type="number" value={row.length || ''} onChange={(e) => updateSizeRow(p, i, 'length', e.target.value)} placeholder="58" />
                      <input value={row.rusSize} onChange={(e) => updateSizeRow(p, i, 'rusSize', e.target.value)} placeholder="44–46" />
                      <button type="button" className="adm-sc-del" onClick={() => removeSizeRow(p, i)} title="Удалить">✕</button>
                    </div>
                  ))}
                  <button type="button" className="adm-sc-add" onClick={() => addSizeRow(p)}>+ добавить размер</button>
                  <label className="adm-f"><span>Памятка (каждая строка — отдельный пункт)</span><textarea rows={4} value={((p.sizeNotes as string[] | undefined) ?? []).join('\n')} onChange={(e) => patchLocal(p.id, 'sizeNotes', e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean))} placeholder={'Замеры по изделию в разложенном виде.\nИзмерьте обхват груди и сравните с таблицей.'} /></label>
                </div>

                {(p.colors ?? []).length > 0 && (
                  <div className="adm-sc">
                    <span className="adm-sc-title">Фото по цветам</span>
                    {(p.colors as string[]).map((color) => (
                      <div className="adm-cp-color" key={color}>
                        <div className="adm-cp-name">{color}</div>
                        <div className="adm-photos">
                          {(((p.colorPhotos ?? {})[color] as string[] | undefined) ?? []).map((u: string, i: number) => (
                            <div
                              className={`adm-photo ${i === 0 ? 'main' : ''}`}
                              key={u}
                              draggable
                              onDragStart={() => setDragPhoto({ productId: p.id, url: u, color })}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => { e.preventDefault(); reorderPhoto(p, u, color) }}
                              title="Перетащите фото в нужный порядок"
                            >
                              <img src={u} alt="" />
                              {i === 0 && <span className="adm-photo-main">1</span>}
                              <button type="button" className="adm-photo-x" onClick={() => removeColorPhoto(p, color, u)}>✕</button>
                            </div>
                          ))}
                          <label className="adm-upload">+ фото<input type="file" accept="image/*" hidden onChange={(e) => e.target.files && e.target.files[0] && uploadColorPhoto(p, color, e.target.files[0])} /></label>
                        </div>
                      </div>
                    ))}
                    <div className="adm-photo-hint">У цвета со своими фото на витрине показываются именно эти фото. Перетащите фото: первое в цвете станет обложкой этого цвета.</div>
                  </div>
                )}

                <button className="btn primary sm" onClick={() => saveProduct(p)} type="button">Сохранить</button>
              </div>
            ))}
            {!products.length && <p className="muted">Нет товаров.</p>}
          </div>
        )}

        {tab === 'orders' && (
          <div className="adm-orders">
            <div className="adm-orders-bar">
              <label className="adm-f inline"><span>Сортировка</span>
                <select value={orderSort} onChange={(e) => setOrderSort(e.target.value)}>
                  <option value="new">Сначала новые</option>
                  <option value="old">Сначала старые</option>
                  <option value="unpaid">Сначала неоплаченные</option>
                  <option value="paid">Сначала оплаченные</option>
                  <option value="amount">По сумме (больше → меньше)</option>
                </select>
              </label>
              <label className="adm-f inline"><span>Статус</span>
                <select value={orderStatusF} onChange={(e) => setOrderStatusF(e.target.value)}>
                  <option value="active">Активные</option>
                  <option value="all">Все</option>
                  {ORDER_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="adm-f inline"><span>Оплата</span>
                <select value={orderPayF} onChange={(e) => setOrderPayF(e.target.value)}>
                  <option value="all">Все</option>
                  <option value="paid">Оплаченные</option>
                  <option value="unpaid">Неоплаченные</option>
                </select>
              </label>
              <label className="adm-f inline"><span>Промо</span>
                <select value={orderPromoF} onChange={(e) => setOrderPromoF(e.target.value)}>
                  <option value="all">Все</option>
                  <option value="promo">С промокодом ({ordersWithPromo})</option>
                  <option value="nopromo">Без промокода</option>
                </select>
              </label>
              <input className="adm-order-search" placeholder="Поиск: имя, телефон, № заказа…" value={orderQ} onChange={(e) => setOrderQ(e.target.value)} />
              <button className="btn ghost sm" onClick={reconcileOrders} disabled={reconciling} type="button">{reconciling ? 'Сверяю…' : '🔄 Проверить оплаты'}</button>
              <span className="muted sm">{sortedOrders.length} из {orders.length}</span>
            </div>
            {sortedOrders.map((o) => {
              const track = String(o.track ?? '')
              const hasTrack = track && !track.startsWith('ожидает') && track !== 'через менеджера'
              const paid = isPaid(o)
              const provider = paymentProvider(o)
              const promoFromList = promoByOrder.get(String(o.id))
              const promoCode = String(o.promoCode || promoFromList?.code || '').trim()
              const promoGift = String(o.promoGift || promoFromList?.gift || '').trim()
              const orderContacts = [
                o.client,
                o.phone,
                String(o.telegram ?? '').trim() ? `TG: ${String(o.telegram ?? '').trim()}` : '',
                o.city,
                o.delivery,
                o.pickupPointName,
              ].filter(Boolean).join(' · ')
              return (
                <div className="adm-card adm-order" key={o.id}>
                  <div className="adm-order-h">
                    <div><b>{o.product}</b> · {[o.color, o.size].filter(Boolean).join(' · ')}<div className="muted sm">{o.id}</div></div>
                    <div className="adm-order-sum">{money(Number(o.total ?? 0))}<span className={`adm-pay ${paid ? 'ok' : ''}`}>{paid ? `оплачен · ${provider}` : `не оплачен · ${provider}`}</span></div>
                  </div>
                  {promoCode && (
                    <div className="adm-order-promo">
                      <span className="adm-order-promo-code">Промокод: {promoCode}</span>
                      {promoGift && <span>{promoGift}</span>}
                    </div>
                  )}
                  <div className="adm-order-meta">{orderContacts}</div>
                  <div className="adm-order-ctl">
                    <label className="adm-f inline"><span>Статус</span><select value={ORDER_STATUS.some(([v]) => v === o.status) ? o.status : ''} onChange={(e) => patchOrder(o.id, { status: e.target.value })}><option value="" disabled>{o.status}</option>{ORDER_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                    {!paid && <button className="btn sm" onClick={() => markPaid(o.id)} type="button">Отметить оплаченным</button>}
                    {paid && o.deliveryProvider === 'cdek' && !hasTrack && <button className="btn sm" onClick={() => createShipment(o.id)} type="button">Создать отправление СДЭК</button>}
                    {hasTrack && <span className="adm-track">трек: <b>{track}</b> <button className="btn ghost sm" onClick={() => sendTrack(o.id)} type="button">отправить клиенту</button></span>}
                    {o.paymentUrl && !paid && <a className="btn ghost sm" href={o.paymentUrl} target="_blank" rel="noreferrer">ссылка оплаты</a>}
                    {o.paymentUrl && paid && <a className="btn ghost sm" href={o.paymentUrl} target="_blank" rel="noreferrer">{provider === 'Долями' ? 'Открыть Долями' : provider === 'Точка' ? '🧾 Чек Точки' : 'Ссылка оплаты'}</a>}
                    <button className="btn ghost sm adm-del-order" onClick={() => deleteOrder(o.id)} type="button">Удалить</button>
                  </div>
                </div>
              )
            })}
            {!orders.length && <p className="muted">Заказов нет.</p>}
          </div>
        )}

        {tab === 'reviews' && (
          <div className="adm-orders">
            {reviews.map((rv) => (
              <div className="adm-card adm-order" key={rv.id}>
                <div className="adm-order-h"><div><b>{'★'.repeat(Math.max(1, Math.min(5, Number(rv.rating) || 5)))}</b> {rv.name || rv.clientName}<div className="muted sm">{rv.approved ? 'одобрен' : 'на модерации'}</div></div></div>
                <p style={{ fontSize: 14, lineHeight: 1.6, margin: '6px 0' }}>{rv.text}</p>
                {rv.photoUrl ? <img src={rv.photoUrl} alt="" style={{ width: 90, height: 110, objectFit: 'cover', border: '1px solid var(--line)', marginBottom: 8 }} /> : null}
                <div className="adm-order-ctl">
                  {!rv.approved && <button className="btn primary sm" onClick={() => approveReview(rv.id)} type="button">Одобрить</button>}
                  <button className="btn ghost sm" onClick={() => deleteReview(rv.id)} type="button">Удалить</button>
                </div>
              </div>
            ))}
            {!reviews.length && <p className="muted">Отзывов нет.</p>}
          </div>
        )}

        {tab === 'promo' && (
          <div>
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <h3 className="dash-h">Сгенерировать промокоды</h3>
              <div className="promo-gen">
                <label className="adm-f"><span>Сколько</span><input type="number" value={promoCount} onChange={(e) => setPromoCount(e.target.value)} /></label>
                <label className="adm-f"><span>Что за подарок</span><input value={promoGift} onChange={(e) => setPromoGift(e.target.value)} placeholder="Подарок в посылке" /></label>
                <button className="btn primary sm" onClick={generatePromo} type="button">Создать</button>
              </div>
              <div className="muted sm" style={{ marginTop: 8 }}>Коды одноразовые. Покупатель вводит код при оформлении → в заказе отметится подарок, код станет «использован». Рассылка кодов подписчикам в ТГ-боте — следующим шагом.</div>
            </div>
            <div className="adm-card">
              <h3 className="dash-h">Промокоды · {promos.filter((p) => !p.used).length} активных / {promos.filter((p) => p.used).length} использовано</h3>
              {promos.length === 0 ? <p className="muted">Промокодов пока нет — создайте выше.</p> : (
                <div className="promo-list">
                  {[...promos].sort((a, b) => Number(a.used) - Number(b.used)).map((p) => (
                    <div className={`promo-item ${p.used ? 'used' : ''}`} key={p.code}>
                      <div className="promo-code">{p.code}</div>
                      <div className="promo-gift">{p.gift}{p.sentToUsername ? ` · выдан @${p.sentToUsername}` : p.sentToChatId ? ` · выдан подписчику` : ''}</div>
                      <div className="promo-status">{p.used ? `✓ использован${p.usedByClient ? ` · ${p.usedByClient}` : ''}` : 'активен'}</div>
                      <button className="btn ghost sm" onClick={() => deletePromo(p.code)} type="button">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
