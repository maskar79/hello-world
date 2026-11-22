(() => {
  const $ = (s) => document.querySelector(s);
  const egp = (n) => `${n.toLocaleString('ar-EG')} ج.م`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const t = params.get('t');
  let tries = 0;

  const STATUS = {
    pending: 'في انتظار تأكيد الدفع من البوابة… ستتفعّل أزرار التحميل تلقائيًا.',
    paid: 'تم تأكيد الدفع بنجاح 🎉 يمكنك تحميل كتبك الآن.',
    failed: 'لم تتم عملية الدفع. لم يتم خصم أي مبلغ — يمكنك المحاولة مرة أخرى من الصفحة الرئيسية.',
  };

  function render(o) {
    $('#status').className = `status ${o.status}`;
    $('#statusText').textContent = STATUS[o.status] || o.status;

    $('#downloads').innerHTML = o.downloads.map((d, i) => `
      <div class="dl">
        ${d.cover
          ? `<div class="cover has-img"><img src="${esc(d.cover)}" alt=""></div>`
          : `<div class="cover" data-color="${esc(d.color || '#333')}"><span class="cover-num">${'١٢٣٤٥٦٧٨٩'[i] || ''}</span></div>`}
        <div><h4>${esc(d.title)}</h4>
          <small>${o.status === 'paid' ? `متبقٍ ${d.remaining.toLocaleString('ar-EG')} مرات تحميل` : 'متاح بعد تأكيد الدفع'}</small></div>
        ${d.url
          ? `<a class="btn primary small" href="${esc(d.url)}" download>تحميل PDF</a>`
          : `<button class="btn primary small" disabled title="يتفعّل بعد الدفع">تحميل PDF</button>`}
      </div>`).join('');
    document.querySelectorAll('.cover[data-color]').forEach((el) => el.style.setProperty('--c', el.dataset.color));

    $('#totals').innerHTML = `
      <dt>المجموع</dt><dd>${egp(o.subtotal)}</dd>
      ${o.discount ? `<dt>خصم (${esc(o.promoCode)})</dt><dd>− ${egp(o.discount)}</dd>` : ''}
      <dt class="grand">المدفوع</dt><dd class="grand">${o.total === 0 ? 'مجانًا' : egp(o.total)}</dd>`;

    if (o.status === 'paid') {
      $('#keep').hidden = false;
      $('#linkInput').value = location.href;
    }
  }

  async function poll() {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
    if (!res.ok) {
      $('#status').className = 'status failed';
      $('#statusText').textContent = 'الطلب غير موجود. تأكد من الرابط.';
      return;
    }
    const o = await res.json();
    render(o);
    // Paymob's server callback may land a few seconds after the redirect.
    if (o.status === 'pending' && tries++ < 60) setTimeout(poll, tries < 10 ? 2000 : 5000);
  }

  $('#copyBtn').addEventListener('click', () => {
    navigator.clipboard?.writeText($('#linkInput').value);
    $('#copyBtn').textContent = 'تم النسخ ✓';
  });

  if (!id || !t) {
    $('#statusText').textContent = 'رابط غير صحيح.';
  } else {
    poll();
  }
})();
