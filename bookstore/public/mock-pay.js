document.querySelectorAll('[data-result]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const p = new URLSearchParams(location.search);
    const res = await fetch('/api/mock/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.get('id'), t: p.get('t'), result: btn.dataset.result }),
    });
    const data = await res.json();
    if (data.redirect) location.href = data.redirect;
  })
);
