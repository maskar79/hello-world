// One part's page: cover, price and buy button, a slider of sample pages
// (opens full screen), then the full description.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ar = (n) => Number(n).toLocaleString('ar-EG');
  const egp = (n) => `${ar(n)} ج.م`;
  const rich = (t) => esc(t).replace(/﴿[^﴾]*﴾/g, (m) => `<span class="q">${m}</span>`);
  const PARTS = ['الجزء الأول', 'الجزء الثاني', 'الجزء الثالث', 'الجزء الرابع', 'الجزء الخامس', 'الجزء السادس'];
  const TOGETHER = { 2: 'الجزءان معًا', 3: 'الأجزاء الثلاثة معًا', 4: 'الأجزاء الأربعة معًا', 5: 'الأجزاء الخمسة معًا' };
  const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

  const n = Number((location.pathname.match(/part-(\d+)/) || [])[1]);
  let samples = [];
  let current = 0;

  function render(c) {
    const b = c.books[n - 1];
    if (!b || b.status === 'soon') { location.replace('/'); return; }
    const bundle = c.bundles.find((x) => x.bookIds.includes(b.id));
    samples = b.samples || [];
    document.title = `${b.title} · ${b.subtitle}`;

    $('#book').innerHTML = `
      <section class="book-hero"><div class="wrap">
        <div class="book-cover"><div class="cover"><img src="${esc(b.cover)}" alt="غلاف ${esc(b.title)}"></div></div>
        <div class="book-info">
          <div class="card-top"><span class="chip">${PARTS[n - 1] || ''}</span></div>
          <h1>${esc(b.title)}</h1>
          <p class="book-sub">${esc(b.subtitle)}</p>
          <p class="book-meta">
            ${b.pages ? `<span>${ar(b.pages)} صفحة</span>` : ''}
            <span>نسخة PDF</span>
            ${b.downloadCount ? `<span class="dlc">${DL_ICON}${ar(b.downloadCount)} تحميل</span>` : ''}
          </p>
          <div class="book-price">${egp(b.price)}</div>
          <div class="hero-actions">
            <a class="btn primary" href="/?add=${encodeURIComponent(b.id)}">أضف للسلة</a>
            ${bundle ? `<a class="btn on-dark" href="/?add=${encodeURIComponent(bundle.id)}">أو ${TOGETHER[bundle.bookIds.length] || esc(bundle.title)} بـ ${egp(bundle.price)}</a>` : ''}
          </div>
          <p class="pdf-note">نسخة إلكترونية PDF، وليست نسخة ورقية مطبوعة · يتفعّل التحميل فور الدفع</p>
        </div>
      </div></section>

      ${samples.length ? `
      <section class="section samples"><div class="wrap">
        <div class="samples-head">
          <h2 class="section-title">تصفّح عينة من الكتاب</h2>
          <div class="slider-nav">
            <button class="icon-btn dark-line" type="button" data-slide="-1" aria-label="السابق"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
            <button class="icon-btn dark-line" type="button" data-slide="1" aria-label="التالي"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>
          </div>
        </div>
        <p class="hint">${ar(samples.length)} صفحات مختارة. اضغط على أي صفحة لتكبيرها.</p>
        <div class="track" id="track">
          ${samples.map((src, i) => `<button class="sample" type="button" data-open="${i}" aria-label="صفحة العينة ${ar(i + 1)}">
            <img src="${esc(src)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}"><span>${ar(i + 1)}</span></button>`).join('')}
        </div>
      </div></section>` : ''}

      <section class="section about"><div class="wrap narrow">
        <h2 class="section-title">عن الكتاب</h2>
        <p class="teaser">${rich(b.teaser)}</p>
        ${b.quote ? `<div class="callout">«${esc(b.quote)}»</div>` : ''}
        ${b.highlights?.length ? `<h3>ماذا ستجد في الكتاب؟</h3><ul>${b.highlights.map((h) => `<li>${rich(h)}</li>`).join('')}</ul>` : ''}
        <div class="hero-actions about-buy">
          <a class="btn primary" href="/?add=${encodeURIComponent(b.id)}">اشترِ ${esc(PARTS[n - 1] || 'الكتاب')} · ${egp(b.price)}</a>
        </div>
      </div></section>`;
  }

  // ---------- slider ----------
  function slide(step) {
    const track = $('#track');
    const rtl = getComputedStyle(track).direction === 'rtl';
    track.scrollBy({ left: step * track.clientWidth * 0.8 * (rtl ? -1 : 1), behavior: 'smooth' });
  }

  // ---------- full-screen viewer ----------
  function show(i) {
    current = (i + samples.length) % samples.length;
    $('#viewerImg').src = samples[current];
    $('#viewerImg').alt = `صفحة العينة ${ar(current + 1)}`;
    $('#viewerCount').textContent = `${ar(current + 1)} / ${ar(samples.length)}`;
  }
  function openViewer(i) { show(i); $('#viewer').showModal(); }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openViewer(Number(open.dataset.open));
    const s = e.target.closest('[data-slide]');
    if (s) return slide(Number(s.dataset.slide));
    const step = e.target.closest('[data-step]');
    if (step) return show(current + Number(step.dataset.step));
    if (e.target.closest('[data-viewer-close]')) $('#viewer').close();
  });
  $('#viewer').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  document.addEventListener('keydown', (e) => {
    if (!$('#viewer').open) return;
    // Right-to-left book: the next page is to the left.
    if (e.key === 'ArrowLeft') show(current + 1);
    if (e.key === 'ArrowRight') show(current - 1);
  });
  // Swipe on phones: drag right for the next page (right-to-left), left for the previous one.
  let x0 = null;
  $('#viewerStage').addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  $('#viewerStage').addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(current + (dx > 0 ? 1 : -1));
  });

  fetch('/api/catalog').then((r) => r.json()).then(render).catch(() => {
    $('#book').innerHTML = '<p class="wrap loading">تعذّر تحميل الصفحة، حاول مرة أخرى.</p>';
  });
})();
