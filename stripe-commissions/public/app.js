'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(epochSeconds) {
  if (!epochSeconds) return '—';
  return new Date(epochSeconds * 1000).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

let toastTimer = null;
function toast(msg, kind) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function api(url, opts) {
  const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
  return data;
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------
$all('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.tab').forEach((b) => b.classList.remove('active'));
    $all('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.tab;
    $('#' + id).classList.add('active');
    loadTab(id);
  });
});

$all('.subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.subtab').forEach((b) => b.classList.remove('active'));
    $all('.subpanel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#' + btn.dataset.subtab).classList.add('active');
    loadCommissionSubtab(btn.dataset.subtab);
  });
});

$all('.refresh').forEach((btn) => {
  btn.addEventListener('click', () => loadTab(btn.dataset.refresh));
});

function loadTab(id) {
  if (id === 'commissions') {
    const active = $('.subtab.active');
    loadCommissionSubtab(active ? active.dataset.subtab : 'pending');
  } else if (id === 'subscriptions') {
    loadSubscriptions(true);
  } else if (id === 'partners') {
    loadPartners();
  }
}

function loadCommissionSubtab(sub) {
  if (sub === 'pending') loadPending();
  else if (sub === 'paid') loadPaid();
  else if (sub === 'upcoming') loadUpcoming();
}

// ---------------------------------------------------------------------------
// Commissions — Pending
// ---------------------------------------------------------------------------
async function loadPending() {
  const body = $('#pending-body');
  body.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const { pending } = await api('/api/commissions/pending');
    if (!pending.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No pending commissions.</td></tr>';
      return;
    }
    body.innerHTML = '';
    pending.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(r.customer) + '</td>' +
        '<td>' + esc(r.partner_name) + '</td>' +
        '<td>' + esc(r.net_amount || '—') + '</td>' +
        '<td>' + fmtDate(r.second_invoice_date) + '</td>' +
        '<td></td>';
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Approve & pay';
      btn.addEventListener('click', () => approve(r.subscription_id, btn));
      tr.lastElementChild.appendChild(btn);
      body.appendChild(tr);
    });
  } catch (err) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Error: ' + esc(err.message) + '</td></tr>';
  }
}

async function approve(subscriptionId, btn) {
  if (!confirm('Approve and pay this commission? This creates a Stripe transfer.')) return;
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const res = await api('/api/commissions/approve', {
      method: 'POST',
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
    if (res.already_paid) toast('Already paid.', 'success');
    else toast('Commission paid: ' + (res.amount || ''), 'success');
    loadPending();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Approve & pay';
  }
}

// ---------------------------------------------------------------------------
// Commissions — Paid
// ---------------------------------------------------------------------------
async function loadPaid() {
  const body = $('#paid-body');
  body.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const { paid } = await api('/api/commissions/paid');
    if (!paid.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No transfers yet.</td></tr>';
      return;
    }
    body.innerHTML = paid.map((r) =>
      '<tr>' +
      '<td>' + esc(r.customer) + '</td>' +
      '<td>' + esc(r.partner_name) + '</td>' +
      '<td>' + esc(r.amount) + '</td>' +
      '<td>' + fmtDate(r.date) + '</td>' +
      '<td class="small">' + esc(r.transfer_id) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Error: ' + esc(err.message) + '</td></tr>';
  }
}

// ---------------------------------------------------------------------------
// Commissions — Upcoming
// ---------------------------------------------------------------------------
async function loadUpcoming() {
  const body = $('#upcoming-body');
  body.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
  try {
    const { upcoming } = await api('/api/commissions/upcoming');
    if (!upcoming.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Nothing upcoming.</td></tr>';
      return;
    }
    body.innerHTML = upcoming.map((r) =>
      '<tr>' +
      '<td>' + esc(r.customer) + '</td>' +
      '<td>' + esc(r.partner_name) + '</td>' +
      '<td><span class="badge ' + r.status + '">' + esc(r.label) + '</span></td>' +
      '<td>' + fmtDate(r.expected_next_charge) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    body.innerHTML = '<tr><td colspan="4" class="muted">Error: ' + esc(err.message) + '</td></tr>';
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
let subsCursor = null;
let subsPartners = [];

async function loadSubscriptions(reset) {
  const body = $('#subscriptions-body');
  if (reset) {
    subsCursor = null;
    body.innerHTML = '<tr><td colspan="7" class="muted">Loading…</td></tr>';
  }
  try {
    const qs = subsCursor ? '?starting_after=' + encodeURIComponent(subsCursor) : '';
    const data = await api('/api/subscriptions' + qs);
    subsPartners = data.partners || [];
    if (reset) body.innerHTML = '';
    if (reset && !data.subscriptions.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No subscriptions.</td></tr>';
    }
    data.subscriptions.forEach((s) => body.appendChild(subscriptionRow(s)));
    subsCursor = data.next_cursor;
    $('#subs-more').hidden = !data.has_more;
  } catch (err) {
    if (reset) body.innerHTML = '<tr><td colspan="7" class="muted">Error: ' + esc(err.message) + '</td></tr>';
    else toast(err.message, 'error');
  }
}

function subscriptionRow(s) {
  const tr = document.createElement('tr');

  // Partner dropdown
  const select = document.createElement('select');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— none —';
  select.appendChild(none);
  subsPartners.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === s.partner_id) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => assignPartner(s.subscription_id, select.value, select));

  tr.innerHTML =
    '<td>' + esc(s.customer) + '<div class="small">' + esc(s.customer_email || '') + '</div></td>' +
    '<td>' + esc(s.product) + '</td>' +
    '<td>' + esc(s.amount || '—') + '</td>' +
    '<td>' + esc(s.subscription_status) + '</td>' +
    '<td class="partner-cell"></td>' +
    '<td><span class="badge ' + s.status + '">' + esc(s.label) + '</span></td>' +
    '<td>' + (s.status === 'AWAITING_2ND' || s.status === 'NO_PAYMENT_YET' ? fmtDate(s.expected_next_charge) : '—') + '</td>';

  tr.querySelector('.partner-cell').appendChild(select);
  return tr;
}

async function assignPartner(subscriptionId, partnerId, select) {
  select.disabled = true;
  try {
    await api('/api/subscriptions/' + encodeURIComponent(subscriptionId) + '/partner', {
      method: 'POST',
      body: JSON.stringify({ partner_id: partnerId }),
    });
    toast('Partner updated.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    select.disabled = false;
  }
}

$('#subs-more').addEventListener('click', () => loadSubscriptions(false));

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------
async function loadPartners() {
  const body = $('#partners-body');
  body.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const { partners } = await api('/api/partners');
    if (!partners.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No Connect accounts linked.</td></tr>';
      return;
    }
    body.innerHTML = '';
    partners.forEach((p) => body.appendChild(partnerRow(p)));
  } catch (err) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Error: ' + esc(err.message) + '</td></tr>';
  }
}

function partnerRow(p) {
  const tr = document.createElement('tr');

  // Name (editable)
  const nameTd = document.createElement('td');
  const nameWrap = document.createElement('div');
  nameWrap.className = 'name-edit';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = p.display_name || '';
  input.placeholder = p.business_name || p.id;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => saveDisplayName(p.id, input.value, saveBtn));
  nameWrap.appendChild(input);
  nameWrap.appendChild(saveBtn);
  nameTd.appendChild(nameWrap);
  if (p.business_name) {
    const sub = document.createElement('div');
    sub.className = 'small';
    sub.textContent = p.business_name;
    nameTd.appendChild(sub);
  }
  tr.appendChild(nameTd);

  // Account ID
  const idTd = document.createElement('td');
  idTd.className = 'small';
  idTd.textContent = p.id;
  tr.appendChild(idTd);

  // Payouts status
  const payTd = document.createElement('td');
  payTd.innerHTML = p.payouts_enabled
    ? '<span class="badge PAID">enabled</span>'
    : '<span class="badge CANCELED_BEFORE_2ND">disabled</span>';
  tr.appendChild(payTd);

  // Automatic payout toggle
  const toggleTd = document.createElement('td');
  const label = document.createElement('label');
  label.className = 'switch';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!p.auto_transfer;
  const slider = document.createElement('span');
  slider.className = 'slider';
  checkbox.addEventListener('change', () => toggleAuto(p.id, checkbox.checked, checkbox));
  label.appendChild(checkbox);
  label.appendChild(slider);
  toggleTd.appendChild(label);
  toggleTd.appendChild(document.createTextNode(' '));
  const mode = document.createElement('span');
  mode.className = 'small';
  mode.textContent = p.auto_transfer ? 'automatic' : 'manual';
  checkbox.addEventListener('change', () => { mode.textContent = checkbox.checked ? 'automatic' : 'manual'; });
  toggleTd.appendChild(mode);
  tr.appendChild(toggleTd);

  tr.appendChild(document.createElement('td'));
  return tr;
}

async function saveDisplayName(id, name, btn) {
  btn.disabled = true;
  try {
    await api('/api/partners/' + encodeURIComponent(id), {
      method: 'POST',
      body: JSON.stringify({ display_name: name }),
    });
    toast('Name saved.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function toggleAuto(id, value, checkbox) {
  checkbox.disabled = true;
  try {
    await api('/api/partners/' + encodeURIComponent(id), {
      method: 'POST',
      body: JSON.stringify({ auto_transfer: value }),
    });
    toast('Payout mode: ' + (value ? 'automatic' : 'manual'), 'success');
  } catch (err) {
    toast(err.message, 'error');
    checkbox.checked = !value;
  } finally {
    checkbox.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadPending();
