(function () {
  const RES = 'spz-crew';
  const el = (id) => document.getElementById(id);
  const root = el('root');
  let inCrew = false;

  const post = (cb, body) =>
    fetch(`https://${RES}/${cb}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json().catch(() => ({}))).catch(() => ({}));

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const initials = (name) =>
    String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  const CROWN = `<svg class="m-crown" viewBox="0 0 24 24" fill="currentColor" aria-label="owner"><path d="M2 8l4.5 3.5L12 3l5.5 8.5L22 8l-2 11H4L2 8z"/></svg>`;

  // ── View switching (segmented control) ───────────────────────────────────────
  function setView(view) {
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== view));
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render(data, list) {
    const crew = data.crew;
    inCrew = !!crew;

    el('mycrew').classList.toggle('hidden', !crew);
    el('create').classList.toggle('hidden', !!crew);
    el('seg-crew').firstChild.textContent = crew ? 'My Crew' : 'Create Crew';
    el('cd').textContent = data.cooldown > 0 ? `cooldown ${data.cooldown}s` : '';
    el('seg-browse-n').textContent = list && list.length ? list.length : '';

    if (crew) {
      const roster = data.roster || [];
      el('crew-name').textContent = crew.name;
      el('crew-role').textContent = crew.isOwner ? 'Owner' : 'Member';
      el('roster-n').textContent = roster.length;

      el('st-members').textContent = roster.length;
      el('st-tag').textContent = crew.tag;
      const irs = roster.map((m) => m.irating).filter((v) => typeof v === 'number');
      el('st-ir').textContent = irs.length ? Math.round(irs.reduce((a, b) => a + b, 0) / irs.length) : '—';

      el('disband').classList.toggle('hidden', !crew.isOwner);

      const r = el('roster');
      r.innerHTML = '';
      roster.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'mrow' + (m.owner ? ' owner' : '');
        row.innerHTML =
          `<span class="m-av">${esc(initials(m.name))}</span>` +
          `<span class="m-name">${esc(m.name)}</span>` +
          (m.owner ? CROWN : '') +
          (m.rank ? `<span class="m-rank">${esc(m.rank)}</span>` : '');
        if (crew.isOwner && !m.owner) {
          const k = document.createElement('button');
          k.className = 'm-kick';
          k.textContent = 'Kick';
          k.onclick = () => post('kick', { pid: m.pid });
          row.appendChild(k);
        }
        r.appendChild(row);
      });
    }

    const lst = el('list');
    lst.innerHTML = '';
    if (!list || list.length === 0) {
      lst.innerHTML = '<div class="empty">No crews yet — be the first to create one.</div>';
    } else {
      list.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'ccard';
        card.innerHTML =
          `<div class="cc-head">` +
            `<span class="cc-emblem">${esc(c.tag)}</span>` +
            `<div class="cc-txt"><span class="cc-name">${esc(c.name)}</span>` +
            `<span class="cc-members">${c.members} member${c.members == 1 ? '' : 's'}</span></div>` +
          `</div>`;
        const j = document.createElement('button');
        j.className = 'btn btn-join';
        j.textContent = inCrew ? 'In Crew' : 'Join';
        j.disabled = inCrew;
        j.onclick = () => post('join', { crewId: c.id });
        card.appendChild(j);
        lst.appendChild(card);
      });
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  el('close').onclick = () => post('close');
  el('leave').onclick = () => post('leave');
  el('disband').onclick = () => { if (confirm('Disband the crew for everyone?')) post('disband'); };
  el('create-btn').onclick = () => {
    const name = el('in-name').value.trim();
    const tag = el('in-tag').value.trim().toUpperCase();
    if (name.length < 3) return;
    post('create', { name, tag });
  };
  el('in-tag').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    el('tag-prev').textContent = e.target.value || '?';
  });

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.action === 'show') root.classList.remove('hidden');
    else if (m.action === 'hide') root.classList.add('hidden');
    else if (m.action === 'data') render(m.data || {}, m.list || []);
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') post('close'); });
})();
