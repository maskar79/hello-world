(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const STATUS = { paid: 'مدفوع', pending: 'قيد الانتظار', failed: 'فشل' };

  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/orders', { headers: { Authorization: `Bearer ${$('#pass').value}` } });
    if (!res.ok) { $('#summary').textContent = 'كلمة المرور غير صحيحة'; return; }
    const orders = await res.json();
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
  });
})();
