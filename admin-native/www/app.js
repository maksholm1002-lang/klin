const DEFAULT_API = 'https://linasia.ru'
const STORAGE = {
  api: 'linAdmin.apiBase',
  token: 'linAdmin.token',
  phone: 'linAdmin.phone',
  costs: 'linAdmin.costs',
  rates: 'linAdmin.rates',
}

const state = {
  tab: 'dashboard',
  loading: false,
  apiBase: localStorage.getItem(STORAGE.api) || DEFAULT_API,
  token: localStorage.getItem(STORAGE.token) || '',
  phone: localStorage.getItem(STORAGE.phone) || '',
  password: '',
  data: { products: [], orders: [], analytics: [], settings: {}, sizes: [] },
  costs: JSON.parse(localStorage.getItem(STORAGE.costs) || '{}'),
  rates: JSON.parse(localStorage.getItem(STORAGE.rates) || '{"tax":4,"acquiring":2.3}'),
  filters: { q: '', status: 'all', pay: 'all' },
  toast: '',
}

const $ = (selector) => document.querySelector(selector)
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`
const pct = (value) => `${Number(value || 0).toFixed(1)}%`
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[s])
const cleanBase = (value) => String(value || '').replace(/\/+$/, '')
const isPaid = (order) => order.paymentStatus === 'paid'
const orderItems = (order) => Array.isArray(order.items) && order.items.length
  ? order.items
  : [{ productId: order.productId, productName: order.product, size: order.size, color: order.color, qty: 1, price: order.productTotal || order.total || 0 }]

function headers(json = true) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${cleanBase(state.apiBase)}${path}`, {
    ...options,
    headers: { ...headers(options.body !== undefined), ...(options.headers || {}) },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`)
  return body
}

async function loadData() {
  state.loading = true
  render()
  try {
    const data = state.token ? await api('/api/admin/bootstrap') : { products: [], orders: [], analytics: [], settings: {}, sizes: [] }
    state.data = {
      products: data.products || [],
      orders: data.orders || [],
      analytics: data.analytics || [],
      settings: data.settings || {},
      sizes: data.sizes || [],
    }
    toast(state.token ? 'Админ-данные обновлены' : 'Войдите в админку')
  } catch (error) {
    if (String(error.message || '').includes('401')) {
      state.token = ''
      localStorage.removeItem(STORAGE.token)
    }
    toast(`Ошибка API: ${error.message}`)
  } finally {
    state.loading = false
    render()
  }
}

async function login() {
  const apiBase = cleanBase($('#loginApiBase')?.value || state.apiBase || DEFAULT_API)
  const phone = ($('#loginPhone')?.value || '').trim()
  const password = $('#loginPassword')?.value || ''
  if (!phone || !password) {
    toast('Введите телефон и пароль')
    return
  }
  state.loading = true
  render()
  try {
    state.apiBase = apiBase
    const response = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.token) throw new Error(body.error || 'Неверный телефон или пароль')
    state.token = body.token
    state.phone = phone
    state.password = ''
    localStorage.setItem(STORAGE.api, apiBase)
    localStorage.setItem(STORAGE.phone, phone)
    localStorage.setItem(STORAGE.token, body.token)
    toast('Вход выполнен')
    await loadData()
  } catch (error) {
    toast(`Не вошли: ${error.message}`)
  } finally {
    state.loading = false
    render()
  }
}

function logout() {
  state.token = ''
  localStorage.removeItem(STORAGE.token)
  render()
}

function saveSettings() {
  state.apiBase = cleanBase($('#apiBase').value || DEFAULT_API)
  state.token = $('#adminToken').value.trim()
  localStorage.setItem(STORAGE.api, state.apiBase)
  localStorage.setItem(STORAGE.token, state.token)
  loadData()
}

function saveCosts() {
  localStorage.setItem(STORAGE.costs, JSON.stringify(state.costs))
  localStorage.setItem(STORAGE.rates, JSON.stringify(state.rates))
  toast('Финансовые настройки сохранены на телефоне')
  render()
}

function toast(message) {
  state.toast = message
  const node = $('.bottom-note')
  if (node) {
    node.textContent = message
    node.classList.add('show')
    clearTimeout(window.__toastTimer)
    window.__toastTimer = setTimeout(() => node.classList.remove('show'), 3200)
  }
}

function stats() {
  const orders = state.data.orders || []
  const products = state.data.products || []
  const paid = orders.filter(isPaid)
  const visits = state.data.analytics.filter((event) => event.type === 'visit').length
  const carts = state.data.analytics.filter((event) => event.type === 'cart_add').length
  const revenue = paid.reduce((sum, order) => sum + Number(order.total || 0), 0)
  const delivery = paid.reduce((sum, order) => sum + Number(order.deliveryCost || 0), 0)
  const active = orders.filter((order) => !['cancelled', 'shipped'].includes(order.status)).length
  const production = orders.filter((order) => order.status === 'production').length
  const shipped = orders.filter((order) => order.status === 'shipped').length
  return { orders, products, paid, visits, carts, revenue, delivery, active, production, shipped }
}

function groupedBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'без данных'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function financeRows() {
  const { paid, products } = stats()
  return products.map((product) => {
    const productOrders = paid.filter((order) => orderItems(order).some((item) => item.productId === product.id || item.productName === product.name))
    const qty = productOrders.reduce((sum, order) => sum + orderItems(order)
      .filter((item) => item.productId === product.id || item.productName === product.name)
      .reduce((s, item) => s + Number(item.qty || 1), 0), 0)
    const revenue = productOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)
    const delivery = productOrders.reduce((sum, order) => sum + Number(order.deliveryCost || 0), 0)
    const cfg = state.costs[product.id] || {}
    const unitCost = Number(cfg.unitCost || 0)
    const packaging = Number(cfg.packaging || 0)
    const ads = Number(cfg.ads || 0)
    const fixed = Number(cfg.fixed || 0)
    const other = Number(cfg.other || 0)
    const tax = revenue * Number(state.rates.tax || 0) / 100
    const acquiring = revenue * Number(state.rates.acquiring || 0) / 100
    const cost = qty * unitCost + qty * packaging + ads + fixed + other + delivery + tax + acquiring
    const profit = revenue - cost
    return { product, qty, revenue, delivery, tax, acquiring, cost, profit, perUnit: qty ? profit / qty : 0, cfg }
  })
}

async function patchOrder(id, payload) {
  try {
    await api(`/api/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
    await loadData()
  } catch (error) {
    toast(`Не сохранилось: ${error.message}`)
  }
}

async function orderAction(id, endpoint) {
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/${endpoint}`, { method: 'POST', body: '{}' })
    await loadData()
  } catch (error) {
    toast(`Ошибка действия: ${error.message}`)
  }
}

function renderShell(inner) {
  const { orders } = stats()
  const connected = state.token && orders.length
  if (!state.token) return renderLogin()
  document.querySelector('#app').innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand"><span class="brand-mark">林</span><span>LIN ADMIN</span></div>
          <div class="status-pill ${connected ? 'ok' : ''}">${state.loading ? 'загрузка...' : connected ? `${orders.length} заказов` : 'нет заказов'}</div>
        </div>
        <nav class="tabs">
          ${[
            ['dashboard', 'Сводка'],
            ['orders', 'Заказы'],
            ['production', 'Отшив'],
            ['finance', 'Деньги'],
            ['traffic', 'UTM'],
          ].map(([id, label]) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
        </nav>
      </header>
      <main class="content">
        <section class="settings">
          <label><span>API</span><input id="apiBase" value="${esc(state.apiBase)}" placeholder="https://linasia.ru" /></label>
          <label><span>Админ-токен</span><input id="adminToken" value="${esc(state.token)}" placeholder="Bearer token из админки" /></label>
          <button class="primary" id="saveSettings">Подключить</button>
          <button id="logoutBtn" type="button">Выйти</button>
        </section>
        ${inner}
      </main>
      <div class="bottom-note"></div>
    </div>
  `
  document.querySelectorAll('[data-tab]').forEach((node) => node.addEventListener('click', () => { state.tab = node.dataset.tab; render() }))
  $('#saveSettings').addEventListener('click', saveSettings)
  $('#logoutBtn').addEventListener('click', logout)
}

function renderLogin() {
  document.querySelector('#app').innerHTML = `
    <div class="app login-app">
      <main class="login-screen">
        <section class="login-card">
          <div class="login-brand"><span class="brand-mark">林</span><span>LIN ADMIN</span></div>
          <p class="sub">Вход в мобильную админку LIN. Данные берутся с текущего сервера.</p>
          <label><span>API</span><input id="loginApiBase" value="${esc(state.apiBase)}" placeholder="https://linasia.ru" /></label>
          <label><span>Телефон админа</span><input id="loginPhone" value="${esc(state.phone)}" inputmode="tel" autocomplete="username" placeholder="+7..." /></label>
          <label><span>Пароль</span><input id="loginPassword" type="password" autocomplete="current-password" placeholder="Пароль" /></label>
          <button class="primary full" id="loginBtn" type="button">${state.loading ? 'Входим...' : 'Войти'}</button>
          <div class="sub sm">Если пароль не подходит, значит на сервере другие ADMIN_PHONE / ADMIN_PASSWORD.</div>
        </section>
      </main>
      <div class="bottom-note ${state.toast ? 'show' : ''}">${esc(state.toast)}</div>
    </div>
  `
  $('#loginBtn').addEventListener('click', login)
  $('#loginPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') login() })
}

function renderDashboard() {
  const s = stats()
  const byStatus = groupedBy(s.orders, (order) => order.status)
  const byPay = groupedBy(s.orders, (order) => order.paymentStatus)
  const colors = groupedBy(s.orders.filter(isPaid), (order) => order.color)
  const sizes = groupedBy(s.orders.filter(isPaid), (order) => order.size)
  renderShell(`
    <section class="grid cards">
      <div class="card"><h3>Выручка</h3><div class="metric">${money(s.revenue)}</div><div class="sub">оплачено: ${s.paid.length}</div></div>
      <div class="card"><h3>Активные</h3><div class="metric">${s.active}</div><div class="sub">в производстве: ${s.production}</div></div>
      <div class="card"><h3>Конверсия</h3><div class="metric">${pct(s.visits ? s.orders.length / s.visits * 100 : 0)}</div><div class="sub">${s.visits} визитов, ${s.carts} корзин</div></div>
      <div class="card"><h3>Доставка</h3><div class="metric">${money(s.delivery)}</div><div class="sub">сумма доставок в оплаченных</div></div>
    </section>
    <section class="grid finance-grid" style="margin-top:12px">
      <div class="card"><h2>Статусы</h2>${Object.entries(byStatus).map(([k,v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<div class="empty">Нет заказов</div>'}</div>
      <div class="card"><h2>Оплата</h2>${Object.entries(byPay).map(([k,v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<div class="empty">Нет оплат</div>'}</div>
      <div class="card"><h2>Цвета топа</h2>${Object.entries(colors).map(([k,v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<div class="empty">Нет данных</div>'}</div>
      <div class="card"><h2>Размеры</h2>${Object.entries(sizes).map(([k,v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<div class="empty">Нет данных</div>'}</div>
    </section>
  `)
}

function filteredOrders() {
  const query = state.filters.q.toLowerCase().trim()
  return (state.data.orders || []).filter((order) => {
    const text = [order.id, order.client, order.phone, order.telegram, order.product, order.color, order.size, order.city, order.track].join(' ').toLowerCase()
    return (!query || text.includes(query))
      && (state.filters.status === 'all' || order.status === state.filters.status)
      && (state.filters.pay === 'all' || order.paymentStatus === state.filters.pay)
  })
}

function renderOrders() {
  const orders = filteredOrders()
  renderShell(`
    <section class="toolbar">
      <input id="q" value="${esc(state.filters.q)}" placeholder="Поиск: имя, телефон, номер, трек..." />
      <select id="statusFilter"><option value="all">Все статусы</option>${['new','paid','production','ready','shipped','cancelled'].map((x) => `<option ${state.filters.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <select id="payFilter"><option value="all">Любая оплата</option>${['pending','paid','failed','manager'].map((x) => `<option ${state.filters.pay === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    </section>
    <section class="order-list">
      ${orders.map((order) => `
        <article class="order">
          <div>
            <div class="order-title">${esc(order.product)} · ${esc(order.color || 'цвет?')} · ${esc(order.size || 'размер?')}</div>
            <div class="order-meta">${esc(order.id)}<br>${esc(order.client)} · ${esc(order.phone)} · ${esc(order.city)} · ${esc(order.deliveryProvider || order.delivery)}<br>${esc(order.address || order.pickupPointName || '')}</div>
            <div style="margin-top:10px">
              <span class="tag ${order.paymentStatus === 'paid' ? 'ok' : 'warn'}">${esc(order.paymentStatus)}</span>
              <span class="tag">${esc(order.status)}</span>
              ${order.track ? `<span class="tag ok">трек ${esc(order.track)}</span>` : '<span class="tag warn">без трека</span>'}
            </div>
          </div>
          <div>
            <div class="money">${money(order.total)}</div>
            <div class="order-actions" style="margin-top:12px">
              <button data-status="${esc(order.id)}:production">В производство</button>
              <button data-status="${esc(order.id)}:ready">Готов</button>
              <button data-status="${esc(order.id)}:shipped">Отправлен</button>
              <button data-act="${esc(order.id)}:create-shipment">СДЭК</button>
              <button data-act="${esc(order.id)}:send-track">Трек клиенту</button>
            </div>
          </div>
        </article>
      `).join('') || '<div class="empty">Заказы не загружены. Вставь админ-токен и нажми "Подключить".</div>'}
    </section>
  `)
  $('#q').addEventListener('input', (event) => { state.filters.q = event.target.value; renderOrders() })
  $('#statusFilter').addEventListener('change', (event) => { state.filters.status = event.target.value; renderOrders() })
  $('#payFilter').addEventListener('change', (event) => { state.filters.pay = event.target.value; renderOrders() })
  document.querySelectorAll('[data-status]').forEach((node) => node.addEventListener('click', () => {
    const [id, status] = node.dataset.status.split(':')
    patchOrder(id, { status })
  }))
  document.querySelectorAll('[data-act]').forEach((node) => node.addEventListener('click', () => {
    const [id, action] = node.dataset.act.split(':')
    orderAction(id, action)
  }))
}

function renderProduction() {
  const paid = stats().paid
  const colors = [...new Set(paid.map((order) => order.color || 'без цвета'))]
  const sizes = [...new Set(paid.map((order) => order.size || 'без размера'))].sort((a, b) => ['XS','S','M','L','XL'].indexOf(a) - ['XS','S','M','L','XL'].indexOf(b))
  renderShell(`
    <div class="card">
      <h2>Таблица отшива по оплаченным заказам</h2>
      <table class="table">
        <thead><tr><th>Цвет</th>${sizes.map((size) => `<th>${esc(size)}</th>`).join('')}<th>Итого</th></tr></thead>
        <tbody>
          ${colors.map((color) => {
            const row = sizes.map((size) => paid.filter((order) => (order.color || 'без цвета') === color && (order.size || 'без размера') === size).length)
            return `<tr><td>${esc(color)}</td>${row.map((v) => `<td><b>${v}</b></td>`).join('')}<td><b>${row.reduce((a,b)=>a+b,0)}</b></td></tr>`
          }).join('') || '<tr><td colspan="6">Нет оплаченных заказов</td></tr>'}
        </tbody>
      </table>
      <p class="sub">Эта таблица считает только оплаченные заказы, чтобы не шить под неоплаченные корзины.</p>
    </div>
  `)
}

function renderFinance() {
  const rows = financeRows()
  const totals = rows.reduce((acc, row) => {
    acc.revenue += row.revenue
    acc.cost += row.cost
    acc.profit += row.profit
    acc.qty += row.qty
    return acc
  }, { revenue: 0, cost: 0, profit: 0, qty: 0 })
  renderShell(`
    <section class="grid cards">
      <div class="card"><h3>Выручка</h3><div class="metric">${money(totals.revenue)}</div></div>
      <div class="card"><h3>Расходы</h3><div class="metric">${money(totals.cost)}</div></div>
      <div class="card"><h3>Прибыль</h3><div class="metric">${money(totals.profit)}</div></div>
      <div class="card"><h3>На единицу</h3><div class="metric">${money(totals.qty ? totals.profit / totals.qty : 0)}</div></div>
    </section>
    <section class="card" style="margin-top:12px">
      <h2>Налог и эквайринг</h2>
      <div class="form-grid">
        <label><span>Налог, %</span><input id="taxRate" type="number" value="${esc(state.rates.tax)}" /></label>
        <label><span>Эквайринг, %</span><input id="acqRate" type="number" value="${esc(state.rates.acquiring)}" /></label>
      </div>
    </section>
    ${rows.map((row) => `
      <section class="card" style="margin-top:12px">
        <h2>${esc(row.product.name)}</h2>
        <div class="row"><span>Продано</span><b>${row.qty}</b></div>
        <div class="row"><span>Выручка</span><b>${money(row.revenue)}</b></div>
        <div class="row"><span>Налог + эквайринг</span><b>${money(row.tax + row.acquiring)}</b></div>
        <div class="row"><span>Прибыль / шт</span><b>${money(row.perUnit)}</b></div>
        <div class="form-grid" style="margin-top:12px">
          ${[
            ['unitCost', 'Себес / шт'],
            ['packaging', 'Упаковка / шт'],
            ['ads', 'Реклама'],
            ['fixed', 'Фикс расходы'],
            ['other', 'Другое'],
          ].map(([key, label]) => `<label><span>${label}</span><input data-cost="${esc(row.product.id)}:${key}" type="number" value="${esc(row.cfg[key] || 0)}" /></label>`).join('')}
        </div>
      </section>
    `).join('')}
    <button class="primary" id="saveCosts" style="margin-top:12px;width:100%">Сохранить расходы</button>
  `)
  $('#taxRate').addEventListener('input', (event) => { state.rates.tax = Number(event.target.value || 0) })
  $('#acqRate').addEventListener('input', (event) => { state.rates.acquiring = Number(event.target.value || 0) })
  document.querySelectorAll('[data-cost]').forEach((node) => node.addEventListener('input', () => {
    const [productId, key] = node.dataset.cost.split(':')
    state.costs[productId] = state.costs[productId] || {}
    state.costs[productId][key] = Number(node.value || 0)
  }))
  $('#saveCosts').addEventListener('click', saveCosts)
}

function renderTraffic() {
  const events = state.data.analytics || []
  const visits = events.filter((event) => event.type === 'visit')
  const sources = Object.entries(groupedBy(visits, (event) => event.utmSource || event.utmCampaign || 'direct'))
    .sort((a, b) => b[1] - a[1])
  const links = [
    ['TikTok', `${state.apiBase}/?utm_source=tiktok&utm_medium=social&utm_campaign=drop02`],
    ['Trends', `${state.apiBase}/?utm_source=trends&utm_medium=social&utm_campaign=drop02`],
    ['Instagram', `${state.apiBase}/?utm_source=instagram&utm_medium=social&utm_campaign=drop02`],
  ]
  renderShell(`
    <section class="card">
      <h2>UTM ссылки</h2>
      ${links.map(([label, url]) => `<div class="row"><span>${label}</span><button data-copy="${esc(url)}">Скопировать</button></div><div class="sub" style="word-break:break-all;margin-bottom:8px">${esc(url)}</div>`).join('')}
    </section>
    <section class="card" style="margin-top:12px">
      <h2>Откуда заходят</h2>
      ${sources.map(([source, count]) => `<div class="row"><span>${esc(source)}</span><b>${count}</b></div>`).join('') || '<div class="empty">Нет UTM-статистики или не подключен админ-токен.</div>'}
    </section>
  `)
  document.querySelectorAll('[data-copy]').forEach((node) => node.addEventListener('click', async () => {
    await navigator.clipboard.writeText(node.dataset.copy)
    toast('Ссылка скопирована')
  }))
}

function render() {
  if (state.tab === 'orders') return renderOrders()
  if (state.tab === 'production') return renderProduction()
  if (state.tab === 'finance') return renderFinance()
  if (state.tab === 'traffic') return renderTraffic()
  return renderDashboard()
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

render()
if (state.token) loadData()
