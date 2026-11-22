(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const egp = (n) => `${n.toLocaleString('ar-EG')} ج.م`;
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
  const PARTS = ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث', 'الجزء الرابع', 'الجزء الخامس', 'الجزء السادس'];
  const AVAILABLE = { 1: 'جزء واحد متاح الآن', 2: 'جزءان متاحان الآن', 3: 'ثلاثة أجزاء متاحة الآن', 4: 'أربعة أجزاء متاحة الآن', 5: 'خمسة أجزاء متاحة الآن' };
  const TOGETHER = { 2: 'الجزءان معًا', 3: 'الأجزاء الثلاثة معًا', 4: 'الأجزاء الأربعة معًا', 5: 'الأجزاء الخمسة معًا', 6: 'الأجزاء الستة معًا' };
  const isSoon = (b) => b && b.status === 'soon';
  const partLabel = (b) => PARTS[catalog.books.indexOf(b)] || '';
  const coverHtml = (b, lazy = true) =>
    `<div class="cover"><img src="${esc(b.cover || '')}" alt="غلاف ${esc(b.title)}"${lazy ? ' loading="lazy"' : ''}></div>`;
  // Quranic text between ﴿ ﴾ is set in the Quran typeface.
  const rich = (t) => esc(t).replace(/﴿[^﴾]*﴾/g, (m) => `<span class="q">${m}</span>`);
  const bundleName = (bundle) => TOGETHER[bundle.bookIds.length] || bundle.title;

  const product = (id) =>
    catalog.books.find((b) => b.id === id) || catalog.bundles.find((b) => b.id === id);

  // ---------- page ----------
  function renderHero() {
    const available = catalog.books.filter((b) => !isSoon(b));
    $('#availableChip').textContent = AVAILABLE[available.length] || 'نسخ PDF';
    $('#fan').innerHTML = available.slice(0, 3).map((b) => coverHtml(b, false)).join('');
    const bundle = catalog.bundles[0];
    if (bundle) {
      $('#heroBundle').textContent = bundleName(bundle);
      $('#heroBundle').dataset.add = bundle.id;
      $('#heroLead').textContent = `رحلةٌ بين القرآن والعقل والتاريخ. اختر جزءًا لتقرأ نبذة عنه، أو احصل على ${bundleName(bundle)} بسعر خاص.`;
    } else {
      $('#heroBundle').hidden = true;
    }
  }

  // Part label on the right, page count in small grey on the far left of the same line.
  const cardTop = (b) => `<div class="card-top"><span class="chip">${partLabel(b)}</span>${b.pages ? `<span class="pages">${b.pages.toLocaleString('ar-EG')} صفحة</span>` : ''}</div>`;

  function renderBooks() {
    $('#booksGrid').innerHTML = catalog.books.map((b) => isSoon(b)
      ? `<div class="card soon">${coverHtml(b)}${cardTop(b)}
          <h3>${esc(b.title)}</h3><p class="sub">${esc(b.subtitle)}</p>
          <div class="row"><span class="soon-tag">قريبًا</span></div></div>`
      : `<button class="card" data-book="${esc(b.id)}" type="button">${coverHtml(b)}
          ${cardTop(b)}
          <h3>${esc(b.title)}</h3><p class="sub">${esc(b.subtitle)}</p>
          <div class="row"><span class="price">${egp(b.price)}</span><span class="hint">تفاصيل الكتاب ←</span></div></button>`).join('');
  }

  function renderBundle() {
    const bundle = catalog.bundles[0];
    if (!bundle) { $('#bundle').hidden = true; return; }
    const full = bundle.bookIds.reduce((s, id) => s + (product(id)?.price || 0), 0);
    const save = full - bundle.price;
    const soon = catalog.books.filter(isSoon).map((b) => `${partLabel(b)} قريبًا.`).join(' ');
    $('#bundleCard').innerHTML = `
      <div>
        ${save > 0 ? `<span class="save">وفّر ${egp(save)}</span>` : ''}
        <h2>${esc(bundleName(bundle))}</h2>
        <p>${esc(bundle.subtitle)}، ملفات PDF تُحمَّل فور الدفع. ${esc(soon)}</p>
      </div>
      <div>
        <div class="big">${egp(bundle.price)} ${save > 0 ? `<span class="strike">${egp(full)}</span>` : ''}</div>
        <button class="btn dark" type="button" data-add="${esc(bundle.id)}">أضف المجموعة للسلة</button>
      </div>`;
  }

  function openBook(id) {
    const b = catalog.books.find((x) => x.id === id);
    if (!b || isSoon(b)) return; // nothing to show or buy yet
    const bundle = catalog.bundles.find((x) => x.bookIds.includes(id));
    $('#bookDetail').innerHTML = `
      ${coverHtml(b, false)}
      <div>
        <span class="chip">${partLabel(b)}</span>
        <h2>${esc(b.title)}</h2>
        <p class="subtitle">${esc(b.subtitle)}</p>
        <p class="meta">${b.pages ? `${b.pages.toLocaleString('ar-EG')} صفحة · ` : ''}نسخة PDF</p>
        <p>${rich(b.teaser)}</p>
        ${b.quote ? `<div class="callout">«${esc(b.quote)}»</div>` : ''}
        ${b.highlights?.length ? `<strong class="h">ماذا ستجد في الكتاب؟</strong><ul>${b.highlights.map((h) => `<li>${rich(h)}</li>`).join('')}</ul>` : ''}
        <div class="buy">
          <span class="price">${egp(b.price)}</span>
          <button class="btn primary" type="button" data-add="${esc(b.id)}">${cart.includes(b.id) ? 'في السلة ✓' : 'أضف للسلة'}</button>
          ${bundle ? `<button class="btn" type="button" data-add="${esc(bundle.id)}">أو ${esc(bundleName(bundle))} بـ ${egp(bundle.price)}</button>` : ''}
        </div>
        <p class="hint">زر التحميل يتفعّل مباشرةً بعد تأكيد الدفع.</p>
      </div>`;
    $('#bookDialog').showModal();
  }

  function renderLibrary() {
    const orders = store.get('myOrders', []);
    if (!orders.length) return;
    const el = $('#myLibrary');
    el.hidden = false;
    el.innerHTML = `لديك ${orders.length === 1 ? 'طلب سابق' : `${orders.length.toLocaleString('ar-EG')} طلبات سابقة`} على هذا الجهاز: ` +
      orders.map((o, i) => `<a href="${esc(o.link)}">الطلب ${(i + 1).toLocaleString('ar-EG')}</a>`).join(' · ');
  }

  // ---------- cart ----------
  function addToCart(id) {
    const p = product(id);
    if (!p || isSoon(p)) return;
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
              <button type="button" data-remove="${esc(id)}">إزالة</button></div>`;
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
      ${data.discount ? `<dt class="disc">خصم (${esc(data.promoCode)})</dt><dd class="disc">− ${egp(data.discount)}</dd>` : ''}
      <dt class="grand">الإجمالي</dt><dd class="grand">${data.total === 0 ? 'مجانًا' : egp(data.total)}</dd>`;
    $('#payBtn').disabled = false;
    $('#payBtn').textContent = data.total === 0 ? 'احصل على الكتب مجانًا' : `ادفع ${egp(data.total)}`;
  }

  function setMsg(sel, text, kind) {
    const el = $(sel);
    delete el.dataset.kind;
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

  // Typing the email twice catches typos before payment.
  const sameEmail = () => {
    const a = $('#email').value.trim().toLowerCase();
    const b = $('#emailConfirm').value.trim().toLowerCase();
    return !b || a === b;
  };
  ['#email', '#emailConfirm'].forEach((sel) => $(sel).addEventListener('input', () => {
    $('#emailConfirm').setCustomValidity(sameEmail() ? '' : 'البريد الإلكتروني غير متطابق');
    if (sameEmail() && $('#checkoutMsg').dataset.kind === 'email') setMsg('#checkoutMsg', '');
  }));

  $('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sameEmail() || !$('#emailConfirm').value.trim()) {
      setMsg('#checkoutMsg', 'البريد الإلكتروني غير متطابق في الخانتين، راجعه من فضلك', 'err');
      $('#checkoutMsg').dataset.kind = 'email';
      $('#emailConfirm').focus();
      return;
    }
    const btn = $('#payBtn');
    btn.disabled = true;
    setMsg('#checkoutMsg', 'جارٍ تحويلك لبوابة الدفع…');
    const f = new FormData(e.target);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart, promoCode,
          customer: { name: f.get('name'), email: f.get('email'), emailConfirm: f.get('emailConfirm'), phone: f.get('phone') },
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
    if (c.emailEnabled) $('.field-note').textContent = 'سنرسل لك رابط التحميل على هذا البريد، فاكتبه بدقة. وهو يُطبع أيضًا على نسختك من الكتاب.';
    cart = cart.filter((id) => product(id) && !isSoon(product(id)));
    renderHero();
    renderBooks();
    renderBundle();
    renderLibrary();
    saveCart();
    if (new URLSearchParams(location.search).get('payment') === 'unknown') {
      const el = $('#myLibrary');
      el.hidden = false;
      el.textContent = 'لم نتمكن من العثور على الطلب. إذا تم خصم المبلغ تواصل معنا عبر واتساب أو البريد في أسفل الصفحة.';
    }
  });
})();
