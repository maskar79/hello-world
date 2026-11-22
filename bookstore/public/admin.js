(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const STATUS = { paid: 'مدفوع', pending: 'قيد الانتظار', failed: 'فشل' };
  const PAYMENTS = {
    paymob: ['paid', 'الدفع عبر Paymob مفعّل ✓'],
    mock: ['pending', 'وضع الاختبار: بوابة دفع وهمية (PAYMENT_PROVIDER=mock)'],
    'not-configured': ['failed', 'الدفع غير مفعّل بعد: أضف مفاتيح Paymob في إعدادات Render (Environment). الأكواد المجانية 100% تعمل.'],
  };
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  let pass = '';

  const api = (url, opts = {}) =>
    fetch(url, { ...opts, headers: { Authorization: `Bearer ${pass}`, ...(opts.headers || {}) } });

  async function loadBooks() {
    const data = await (await api('/api/admin/books')).json();
    const [cls, text] = PAYMENTS[data.payments];
    $('#paymentsStatus').className = `status ${cls}`;
    $('#paymentsStatus').innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
    const st = $('#storageStatus');
    st.hidden = data.storage !== 'json' || location.hostname === 'localhost';
    st.className = 'status failed';
    st.innerHTML = '<span class="dot"></span><span>تحذير: لا توجد قاعدة بيانات (DATABASE_URL). الطلبات محفوظة في ملف مؤقت وقد تُمسح عند إعادة تشغيل السيرفر، فيفقد المشترون روابط التحميل.</span>';
    $('#booksHint').textContent = data.uploadsEnabled
      ? 'ارفع ملف الـ PDF لكل كتاب. الملفات تُحفظ على السيرفر فقط ولا يستطيع أحد تحميلها إلا بعد الدفع.'
      : 'الرفع من هنا متوقف على هذا السيرفر. لإضافة أو تغيير كتاب: ارفعه على GitHub داخل فولدر bookstore/private/books (والريبو Private)، وRender سيعيد النشر تلقائيًا. هنا تتأكد أن الملفات وصلت.';
    $('#books').innerHTML = data.books.map((b) => `
      <div class="dl upload-row">
        <div class="badge-state ${b.uploaded ? 'ok' : 'missing'}">${b.uploaded ? '✓' : '!'}</div>
        <div><h4>${esc(b.title)}</h4>
          <small>${esc(b.file)} — ${b.soon ? 'قريبًا (غير معروض للبيع، لا يحتاج ملفًا الآن)' : b.uploaded ? `مرفوع (${mb(b.size)})` : 'لم يُرفع بعد'}</small>
          <div class="progress" hidden><span></span></div></div>
        ${data.uploadsEnabled ? `<label class="btn small">${b.uploaded ? 'استبدال' : 'رفع PDF'}
          <input type="file" accept="application/pdf,.pdf" data-book="${esc(b.id)}" hidden></label>` : '<span></span>'}
      </div>`).join('');
  }

  // XHR (not fetch) so we can show upload progress for large PDFs.
  function upload(bookId, file, row) {
    const bar = row.querySelector('.progress');
    const small = row.querySelector('small');
    bar.hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/admin/books/${encodeURIComponent(bookId)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${pass}`);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) bar.firstElementChild.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.onload = () => {
      if (xhr.status === 200) return loadBooks();
      bar.hidden = true;
      small.textContent = (() => { try { return JSON.parse(xhr.responseText).error; } catch { return 'فشل الرفع'; } })();
    };
    xhr.onerror = () => { bar.hidden = true; small.textContent = 'انقطع الاتصال أثناء الرفع'; };
    small.textContent = `جارٍ رفع ${file.name}…`;
    xhr.send(file);
  }

  async function loadOrders() {
    const orders = await (await api('/api/admin/orders')).json();
    const paid = orders.filter((o) => o.status === 'paid');
    const revenue = paid.reduce((s, o) => s + o.total, 0);
    $('#summary').textContent = `الطلبات المدفوعة: ${paid.length} · الإيراد: ${revenue.toLocaleString('ar-EG')} ج.م · إجمالي الطلبات: ${orders.length}`;
    $('#table').innerHTML = `<tr><th>التاريخ</th><th>الحالة</th><th>العميل</th><th>المنتجات</th><th>الإجمالي</th><th>الكود</th><th>رابط الطلب</th></tr>` +
      orders.map((o) => `<tr>
        <td>${esc(new Date(o.createdAt).toLocaleString('ar-EG'))}</td>
        <td>${esc(STATUS[o.status] || o.status)}</td>
        <td>${esc(o.customer.name)}<br><small dir="ltr">${esc(o.customer.email)}<br>${esc(o.customer.phone)}</small></td>
        <td>${o.items.map(esc).join('<br>')}</td>
        <td>${o.total}${o.discount ? ` <small>(خصم ${o.discount})</small>` : ''}</td>
        <td>${esc(o.promoCode || '—')}</td>
        <td><input readonly value="${esc(o.link)}" dir="ltr"></td>
      </tr>`).join('');
  }

  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    pass = $('#pass').value;
    const res = await api('/api/admin/books');
    if (!res.ok) { $('#loginMsg').textContent = 'كلمة المرور غير صحيحة'; $('#loginMsg').className = 'msg err'; return; }
    $('#loginMsg').textContent = '';
    $('#login').hidden = true;
    $('#panel').hidden = false;
    await Promise.all([loadBooks(), loadOrders()]);
  });

  $('#books').addEventListener('change', (e) => {
    const input = e.target.closest('input[type=file][data-book]');
    if (input?.files[0]) upload(input.dataset.book, input.files[0], input.closest('.upload-row'));
  });
})();
