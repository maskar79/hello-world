(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const egp = (n) => `${n.toLocaleString('ar-EG')} ج.م`;
  const ARABIC_NUMS = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let catalog = null;
  let cart = store.get('cart', []);
  let promoCode = '';
  let quote = null;

  // ---------- rendering helpers ----------
  function coverHtml(book, index) {
    const img = book.cover ? `<img src="${esc(book.cover)}" alt="">` : '';
    return `<div class="cover" data-color="${esc(book.color || '#333')}">
      ${img}
      <span class="cover-num">${ARABIC_NUMS[index] || ''}</span>
      <div><div class="cover-line"></div><div class="cover-title">${esc(book.title)}</div></div>
    </div>`;
  }
  // CSP blocks inline style attributes, so apply colors through the CSSOM.
  function paintCovers(root = document) {
    root.querySelectorAll('.cover[data-color]').forEach((el) => el.style.setProperty('--c', el.dataset.color));
  }

  const product = (id) =>
    catalog.books.find((b) => b.id === id) || catalog.bundles.find((b) => b.id === id);

  // ---------- page ----------
  function renderBooks() {
    $('#booksGrid').innerHTML = catalog.books
      .map((b, i) => `
        <button class="card" data-book="${esc(b.id)}" type="button">
          ${coverHtml(b, i)}
          <h3>${esc(b.title)}</h3>
          <p class="sub">${esc(b.subtitle)}</p>
          <div class="row"><span class="price">${egp(b.price)}</span><span class="hint">اقرأ النبذة ←</span></div>
        </button>`)
      .join('');
    paintCovers($('#booksGrid'));
  }

  function renderBundle() {
    const bundle = catalog.bundles[0];
    if (!bundle) { $('#bundle').hidden = true; return; }
    const full = bundle.bookIds.reduce((s, id) => s + (product(id)?.price || 0), 0);
    const save = full - bundle.price;
    $('#bundleCard').innerHTML = `
      <div>
        ${save > 0 ? `<span class="save">وفّر ${egp(save)}</span>` : ''}
        <h2>${esc(bundle.title)}</h2>
        <p>${esc(bundle.subtitle)}</p>
        <div class="big-price">${egp(bundle.price)} ${save > 0 ? `<span class="strike">${egp(full)}</span>` : ''}</div>
        <button class="btn primary" data-add="${esc(bundle.id)}">أضف المجموعة للسلة</button>
      </div>
      <div class="stack">${bundle.bookIds.map((id) => coverHtml(product(id), catalog.books.findIndex((b) => b.id === id))).join('')}</div>`;
    paintCovers($('#bundleCard'));
  }

  function openBook(id) {
    const i = catalog.books.findIndex((b) => b.id === id);
    const b = catalog.books[i];
    const bundle = catalog.bundles.find((x) => x.bookIds.includes(id));
    $('#bookDetail').innerHTML = `
      ${coverHtml(b, i)}
      <div>
        <h2>${esc(b.title)}</h2>
        <p class="sub">${esc(b.subtitle)}</p>
        <p class="meta">${b.pages ? `${b.pagesApprox ? 'نحو ' : ''}${b.pages.toLocaleString('ar-EG')} صفحة · ` : ''}نسخة PDF</p>
        <p>${esc(b.teaser)}</p>
        ${b.quote ? `<blockquote>«${esc(b.quote)}»</blockquote>` : ''}
        ${b.highlights?.length ? `<strong>ماذا ستجد في الكتاب؟</strong><ul>${b.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        <div class="buy">
          <span class="price">${egp(b.price)}</span>
          <button class="btn primary" data-add="${esc(b.id)}">${cart.includes(b.id) ? 'في السلة ✓' : 'أضف للسلة'}</button>
          ${bundle ? `<button class="btn ghost" data-add="${esc(bundle.id)}">أو المجموعة كاملة بـ ${egp(bundle.price)}</button>` : ''}
        </div>
        <p class="hint">زر التحميل يتفعّل مباشرةً بعد تأكيد الدفع.</p>
      </div>`;
    paintCovers($('#bookDetail'));
    $('#bookDialog').showModal();
  }

  function renderLibrary() {
    const orders = store.get('myOrders', []);
    if (!orders.length) return;
    const el = $('#myLibrary');
    el.hidden = false;
    el.innerHTML = `📚 لديك ${orders.length === 1 ? 'طلب سابق' : `${orders.length.toLocaleString('ar-EG')} طلبات سابقة`} على هذا الجهاز: ` +
      orders.map((o, i) => `<a href="${esc(o.link)}">الطلب ${(i + 1).toLocaleString('ar-EG')}</a>`).join(' · ');
  }

  // ---------- cart ----------
  function addToCart(id) {
    const p = product(id);
    if (!p) return;
    if (p.bookIds) {
      // bundle replaces the individual books it contains
      cart = cart.filter((x) => !p.bookIds.includes(x));
    } else if (cart.some((x) => product(x)?.bookIds?.includes(id))) {
      openDrawer();
      return; // already covered by the bundle
    }
    if (!cart.includes(id)) cart.push(id);
    saveCart();
    if ($('#bookDialog').open) $('#bookDialog').close();
    openDrawer();
  }

  function removeFromCart(id) {
    cart = cart.filter((x) => x !== id);
    saveCart();
  }

  function saveCart() {
    store.set('cart', cart);
    $('#cartCount').textContent = cart.length.toLocaleString('ar-EG');
    refreshQuote();
  }

  async function refreshQuote() {
    const lines = $('#cartLines');
    if (!cart.length) {
      quote = null;
      lines.innerHTML = '<p class="empty">السلة فارغة</p>';
      $('#totals').innerHTML = '';
      $('#payBtn').disabled = true;
      return;
    }
    lines.innerHTML = cart.map((id) => {
      const p = product(id);
      return `<div class="cart-line"><div><strong>${esc(p.title)}</strong><br><span class="hint">${egp(p.price)}</span></div>
              <button data-remove="${esc(id)}">إزالة</button></div>`;
    }).join('');

    const res = await fetch('/api/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, promoCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (promoCode) { // drop invalid promo, keep cart
        setMsg('#promoMsg', data.error, 'err');
        promoCode = '';
        return refreshQuote();
      }
      setMsg('#checkoutMsg', data.error, 'err');
      return;
    }
    quote = data;
    $('#totals').innerHTML = `
      <dt>المجموع</dt><dd>${egp(data.subtotal)}</dd>
      ${data.discount ? `<dt>خصم (${esc(data.promoCode)})</dt><dd>− ${egp(data.discount)}</dd>` : ''}
      <dt class="grand">الإجمالي</dt><dd class="grand">${data.total === 0 ? 'مجانًا' : egp(data.total)}</dd>`;
    $('#payBtn').disabled = false;
    $('#payBtn').textContent = data.total === 0 ? 'احصل على الكتب مجانًا' : `ادفع ${egp(data.total)}`;
  }

  function setMsg(sel, text, kind) {
    const el = $(sel);
    el.textContent = text || '';
    el.className = `msg ${kind || ''}`;
  }

  function openDrawer() {
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#scrim').classList.add('show');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('show');
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addToCart(add.dataset.add);
    const rm = e.target.closest('[data-remove]');
    if (rm) return removeFromCart(rm.dataset.remove);
    const card = e.target.closest('[data-book]');
    if (card) return openBook(card.dataset.book);
    if (e.target.closest('[data-close]')) $('#bookDialog').close();
  });
  $('#bookDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#cartBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  $('#promoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    promoCode = $('#promoInput').value.trim();
    setMsg('#promoMsg', '');
    await refreshQuote();
    if (promoCode && quote?.discount) setMsg('#promoMsg', `تم تطبيق الكود — وفّرت ${egp(quote.discount)}`, 'ok');
  });

  $('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#payBtn');
    btn.disabled = true;
    setMsg('#checkoutMsg', 'جارٍ تحويلك لبوابة الدفع…');
    const f = new FormData(e.target);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart, promoCode,
          customer: { name: f.get('name'), email: f.get('email'), phone: f.get('phone') },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'حدث خطأ');
      // Remember the order link on this device so the buyer can come back to download.
      store.set('myOrders', [...store.get('myOrders', []), { id: data.orderId, link: data.orderLink }]);
      cart = [];
      store.set('cart', cart);
      location.href = data.redirect;
    } catch (err) {
      setMsg('#checkoutMsg', err.message, 'err');
      btn.disabled = false;
    }
  });

  // ---------- boot ----------
  $('#year').textContent = new Date().getFullYear();
  fetch('/api/catalog').then((r) => r.json()).then((c) => {
    catalog = c;
    cart = cart.filter((id) => product(id));
    renderBooks();
    renderBundle();
    renderLibrary();
    saveCart();
    if (new URLSearchParams(location.search).get('payment') === 'unknown') {
      alert('لم نتمكن من العثور على الطلب. إذا تم خصم المبلغ تواصل معنا.');
    }
  });
})();
