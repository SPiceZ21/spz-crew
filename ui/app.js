'use strict';

// Crew dashboard — same shell as the leaderboard tablet: icon rail, hero,
// controls row, expandable rows.

const RES = 'spz-crew';

const root        = document.getElementById('root');
const body        = document.getElementById('body');
const railEl      = document.getElementById('rail');
const sortSeg     = document.getElementById('sortSeg');
const chipbar     = document.getElementById('chipbar');
const heroTitle   = document.getElementById('heroTitle');
const heroSub     = document.getElementById('heroSub');
const heroCount   = document.getElementById('heroCount');
const heroCountL  = document.getElementById('heroCountL');
const heroBtns    = document.getElementById('heroBtns');
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');

let activeTab  = 'crew';
let activeSort = null;
let filterText = '';
let openRow    = null;
let data       = {};    // { crew, roster, cooldown, myPid }
let list       = [];    // browsable crews
let invitable  = null;  // online crewless drivers, fetched when Settings opens
let rival      = null;  // crew head-to-head, fetched when the Rival tab opens

const post = (cb, payload) =>
  fetch(`https://${RES}/${cb}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }).then(r => r.json().catch(() => ({}))).catch(() => ({}));

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// ── Icons ────────────────────────────────────────────────────────────────────
function ico(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
const ICONS = {
  crew:   ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  browse: ico('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  invites: ico('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
  rival: ico('<path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3 14 10"/><path d="m3 21 7-7"/><path d="M8 3H3v5"/><path d="m3 3 7 7"/><path d="M16 21h5v-5"/><path d="m21 21-7-7"/>'),
  settings: ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  caret:  ico('<polyline points="6 9 12 15 18 9"/>'),
};
const CROWN = `<svg class="crown" viewBox="0 0 24 24" fill="currentColor"><path d="M2 8l4.5 3.5L12 3l5.5 8.5L22 8l-2 11H4L2 8z"/></svg>`;

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = {
  crew: {
    label: 'My crew',
    title: 'My crew',
    sub: 'Your roster, ranked by championship points.',
    unit: 'Members',
    sorts: [
      { key: 'points',  label: 'Points'  },
      { key: 'irating', label: 'iRating' },
      { key: 'wins',    label: 'Wins'    },
      { key: 'races',   label: 'Races'   },
    ],
  },
  rival: {
    label: 'Rival crew',
    title: 'Rival crew',
    sub: 'Matched on average rating. Track by track, whose crew holds the quicker lap.',
    unit: 'Tracks',
    sorts: [
      { key: '_margin', label: 'Margin' },
      { key: '_track',  label: 'Track'  },
    ],
  },
  invites: {
    label: 'Invites',
    title: 'Crew invites',
    sub: 'Crews that asked you to join. Accepting takes you straight in, even if they are closed.',
    unit: 'Invites',
    sorts: [],
  },
  settings: {
    label: 'Crew settings',
    title: 'Crew settings',
    sub: 'Name, tag, image, description and recruiting — plus ownership.',
    unit: '',
    sorts: [],
  },
  browse: {
    label: 'Browse crews',
    title: 'Browse crews',
    sub: 'Every crew on the server — size, average rating and total points.',
    unit: 'Crews',
    sorts: [
      { key: 'members',     label: 'Members' },
      { key: 'points',      label: 'Points'  },
      { key: 'avg_irating', label: 'Avg iR'  },
    ],
  },
};
// Settings needs a crew; Invites only shows up when one is waiting (or when
// you have no crew, so there is somewhere to look).
function tabKeys() {
  const keys = ['crew'];
  if (data.crew) keys.push('rival', 'settings');
  if ((data.invites || []).length || !data.crew) keys.push('invites');
  keys.push('browse');
  return keys;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
// Discord picture from the profile when there is one, else a coloured initial.
function avatar(name, url, big) {
  const n = String(name || '?').trim();
  const cls = `avatar${big ? ' av-lg' : ''}`;
  const hue = hashHue(n.toLowerCase());
  const initial = esc(n.charAt(0).toUpperCase() || '?');
  if (url && /^https?:\/\//i.test(url)) {
    return `<div class="${cls}" style="--av:hsl(${hue} 62% 62%)">
      <img src="${esc(url)}" alt="" draggable="false" loading="lazy"
           onerror="this.remove();this.parentNode.textContent='${initial}'"></div>`;
  }
  return `<div class="${cls}" style="--av:hsl(${hue} 62% 62%)">${initial}</div>`;
}
// Crew crest: the uploaded image when there is one, else the text tag.
function crewCrest(crew, cls) {
  const tag = esc(crew.tag || '??');
  if (crew.image && /^https:\/\//i.test(crew.image)) {
    return `<div class="${cls} has-img"><img src="${esc(crew.image)}" alt=""
      onerror="this.parentNode.classList.remove('has-img');this.parentNode.textContent='${tag}'"></div>`;
  }
  return `<div class="${cls}">${tag}</div>`;
}

// 4821 (seconds) → "1h 20m"
function playtime(sec) {
  const s = num(sec);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
// unix seconds → "2026-08-29"
function stamp(unix) {
  const n = num(unix);
  if (!n) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function bar(value, max, colour) {
  const pct = max > 0 ? Math.max(3, Math.min(100, (num(value) / max) * 100)) : 0;
  return `<div class="col-bar"><i style="width:${pct}%${colour ? `;--bar:${colour}` : ''}"></i></div>`;
}
function maxOf(rows, pick) { return rows.reduce((m, r) => Math.max(m, num(pick(r))), 0); }
function emptyState(msg) { return `<div class="state"><span>${esc(msg)}</span></div>`; }

// `bare` returns just the cards, for callers that build their own panel.
function detailCards(items, bare) {
  const cards = items
    .filter(d => d && d[1] != null && d[1] !== '')
    .map(d => `<div class="dcard"><div class="dcard-l">${esc(d[0])}</div><div class="dcard-v">${esc(d[1])}</div></div>`)
    .join('');
  const inner = cards || `<div class="dcard"><div class="dcard-v" style="color:var(--tx-4)">Nothing else recorded yet.</div></div>`;
  return bare ? inner : `<div class="row-detail"><div class="detail-grid">${inner}</div></div>`;
}

// ── Chrome ───────────────────────────────────────────────────────────────────
function buildNav() {
  const pending = (data.invites || []).length;
  railEl.innerHTML = tabKeys().map(t => {
    const badge = (t === 'invites' && pending) ? `<b class="rail-badge">${pending}</b>` : '';
    return `<button class="rail-btn${t === activeTab ? ' active' : ''}" data-tab="${t}" title="${TABS[t].label}">${ICONS[t]}${badge}</button>`;
  }).join('');
}

function buildSorts() {
  const sorts = TABS[activeTab].sorts;
  if (!sorts.some(s => s.key === activeSort)) activeSort = sorts[0].key;
  sortSeg.innerHTML = sorts.map(s =>
    `<button class="seg-btn${s.key === activeSort ? ' active' : ''}" data-sort="${s.key}">${s.label}</button>`
  ).join('');
}

function buildChips(count) {
  const cd = num(data.cooldown) > 0
    ? `<div class="chip-info">Cooldown <b>${num(data.cooldown)}s</b></div>` : '';
  chipbar.innerHTML = `${cd}<div class="chip-info">Showing <b>${fmtNum(count)}</b></div>`;
}

function buildHeroButtons() {
  const crew = data.crew;
  if (activeTab !== 'crew' || !crew) { heroBtns.innerHTML = ''; return; }
  heroBtns.innerHTML = `
    <button class="btn" id="leaveBtn">Leave crew</button>
    ${crew.isOwner ? `<button class="btn btn-danger" id="disbandBtn">Disband</button>` : ''}`;
}

function sortRows(rows) {
  const spec = (TABS[activeTab].sorts || []).find(s => s.key === activeSort);
  if (!spec) return rows;
  return rows.slice().sort((a, b) => num(b[spec.key]) - num(a[spec.key]));
}

// ── My crew ──────────────────────────────────────────────────────────────────
function renderCrew() {
  const crew = data.crew;
  if (!crew) return renderCreate();

  const roster = Array.isArray(data.roster) ? data.roster : [];
  const filtered = filterText
    ? roster.filter(m => String(m.name || '').toLowerCase().includes(filterText))
    : roster;
  const rows = sortRows(filtered);

  const irs = roster.map(m => num(m.irating)).filter(Boolean);
  const avgIr = irs.length ? Math.round(irs.reduce((a, b) => a + b, 0) / irs.length) : 0;
  const points = roster.reduce((a, m) => a + num(m.points), 0);
  const wins = roster.reduce((a, m) => a + num(m.wins), 0);

  const crest = `
    <div class="crest">
      ${crewCrest(crew, 'crest-tag')}
      <div class="crest-txt">
        <div class="crest-name">${esc(crew.name || 'Crew')}</div>
        <div class="crest-meta">
          <span class="pill ${crew.isOwner ? 'owner' : ''}">${crew.isOwner ? 'Owner' : 'Member'}</span>
          ${crew.owner ? ` &nbsp;Led by ${esc(crew.owner)}` : ''}
          ${crew.created_at ? ` &nbsp;· Founded ${esc(String(crew.created_at).slice(0, 10))}` : ''}
        </div>
        ${crew.isOwner ? `<button class="btn btn-sm crest-edit" id="editImgBtn">${crew.image ? 'Change image' : 'Add crew image'}</button>` : ''}
      </div>
      <div class="crest-stats">
        <div class="crest-stat"><span class="crest-stat-v">${fmtNum(roster.length)}</span><span class="crest-stat-l">Members</span></div>
        <div class="crest-stat"><span class="crest-stat-v">${avgIr || '—'}</span><span class="crest-stat-l">Avg iR</span></div>
        <div class="crest-stat"><span class="crest-stat-v">${fmtNum(wins)}</span><span class="crest-stat-l">Wins</span></div>
        <div class="crest-stat"><span class="crest-stat-v">${fmtNum(points)}</span><span class="crest-stat-l">Points</span></div>
      </div>
    </div>`;

  if (!rows.length) return crest + emptyState(filterText ? 'No member matches that search.' : 'No members yet.');

  const maxPts = maxOf(roster, m => m.points);
  const maxIr  = maxOf(roster, m => m.irating);
  const maxWin = maxOf(roster, m => m.wins);

  const head = `<div class="thead">
    <span style="min-width:46px">Place</span>
    <span style="flex:1;margin-left:10px">Driver</span>
    <span style="width:104px">iRating</span>
    <span style="width:104px">Wins</span>
    <span style="width:104px">Points</span>
    <span style="width:20px"></span>
  </div>`;

  const html = rows.map((m, i) => {
    const key = String(m.pid);
    const mine = data.myPid && m.pid === data.myPid;
    const canKick = crew.isOwner && !m.owner;

    return `<div class="row ${m.owner ? 'is-owner' : ''} ${mine ? 'mine' : ''} ${openRow === key ? 'open' : ''}" data-key="${esc(key)}">
      <div class="row-main">
        <div class="pos">#${i + 1}</div>
        <div class="who">${avatar(m.name, m.avatar)}<div class="who-txt">
          <div class="nm">${esc(m.name || 'Driver')} ${m.owner ? CROWN : ''}</div>
          <div class="meta">${esc(m.rank || 'Driver')} · LVL ${num(m.level, 1)}${mine ? ' · you' : ''}</div>
        </div></div>
        <div class="col"><div class="col-v">${fmtNum(m.irating)}</div>${bar(m.irating, maxIr, 'var(--blue)')}</div>
        <div class="col"><div class="col-v">${fmtNum(m.wins)}</div>${bar(m.wins, maxWin, 'var(--green)')}</div>
        <div class="col"><div class="col-v">${fmtNum(m.points)}</div>${bar(m.points, maxPts)}</div>
        <div class="caret">${ICONS.caret}</div>
      </div>
      <div class="row-detail">
        <div class="detail-grid">
          ${detailCards([
            ['Races', fmtNum(m.races)],
            ['Win rate', m.races ? Math.round(num(m.wins) / num(m.races, 1) * 100) + '%' : null],
            ['Podiums', m.podiums != null ? fmtNum(m.podiums) : null],
            ['Safety rating', num(m.sr, 3).toFixed(2)],
            ['Playtime', playtime(m.playtime)],
            ['Last raced', m.last_track ? `${m.last_track}${stamp(m.last_race_at) ? ' · ' + stamp(m.last_race_at) : ''}` : null],
          ], true)}
          ${canKick ? `<div class="dcard"><div class="dcard-l">Owner action</div>
            <div class="dcard-v"><button class="btn btn-danger btn-sm" data-kick="${esc(String(m.pid))}">Kick from crew</button></div></div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  searchCount.textContent = filterText ? `${filtered.length}/${roster.length}` : '';
  return crest + head + html;
}

function renderCreate() {
  return `
    <div class="create">
      <div class="create-emblem" id="tagPrev">?</div>
      <div class="create-title">Start your crew</div>
      <div class="create-hint">Pick a name and a short tag. You become the owner.</div>

      <label class="fld-label" for="inName">Crew name</label>
      <input id="inName" class="fld" type="text" maxlength="24" placeholder="e.g. Night Runners">

      <label class="fld-label" for="inTag">Tag <span class="fld-note">2–4 characters, uppercase</span></label>
      <input id="inTag" class="fld" type="text" maxlength="4" placeholder="NR">

      <button class="btn btn-primary" id="createBtn">Create crew</button>
    </div>`;
}

// ── Rival crew ───────────────────────────────────────────────────────────────
// 84512 → "1:24.512"
function msToLap(ms) {
  const n = num(ms);
  if (n <= 0) return '—';
  const m = Math.floor(n / 60000), sec = Math.floor((n % 60000) / 1000), t = Math.floor(n % 1000);
  return `${m}:${String(sec).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function renderRival() {
  if (rival === null) return `<div class="state"><div class="spinner"></div><span>Finding your rival crew…</span></div>`;
  if (!rival.rival) {
    return emptyState('No rival crew yet — there needs to be another crew with members on the server.');
  }

  const me = rival.me || {};
  const them = rival.rival;
  const h2h = rival.head_to_head || {};
  const tracks = Array.isArray(rival.tracks) ? rival.tracks : [];
  const lead = num(h2h.wins) - num(h2h.losses);

  const stat = (label, a, b, better) => `
    <div class="vs-stat">
      <span class="vs-stat-v ${better === 'a' ? 'up' : ''}">${a}</span>
      <span class="vs-stat-l">${esc(label)}</span>
      <span class="vs-stat-v ${better === 'b' ? 'up' : ''}">${b}</span>
    </div>`;

  const cmp = (x, y) => num(x) === num(y) ? null : (num(x) > num(y) ? 'a' : 'b');

  const header = `
    <div class="versus">
      <div class="vs-side">
        ${crewCrest(me, 'crest-tag')}
        <div class="vs-txt">
          <div class="vs-name">${esc(me.name || 'Your crew')}</div>
          <div class="vs-meta">${fmtNum(me.avg_irating)} avg iR · ${fmtNum(me.members)} members</div>
        </div>
      </div>

      <div class="vs-mid">
        <div class="vs-score">
          <b class="${lead > 0 ? 'up' : ''}">${fmtNum(h2h.wins)}</b><span>–</span><b class="${lead < 0 ? 'down' : ''}">${fmtNum(h2h.losses)}</b>
        </div>
        <div class="vs-label">${num(h2h.tracks)} shared track${num(h2h.tracks) === 1 ? '' : 's'}</div>
      </div>

      <div class="vs-side vs-right">
        <div class="vs-txt">
          <div class="vs-name">${esc(them.name || 'Rival crew')}</div>
          <div class="vs-meta">${fmtNum(them.avg_irating)} avg iR · ${fmtNum(them.members)} members</div>
        </div>
        ${crewCrest(them, 'crest-tag')}
      </div>
    </div>

    <div class="set-card vs-stats">
      ${stat('Championship points', fmtNum(me.points), fmtNum(them.points), cmp(me.points, them.points))}
      ${stat('Race wins', fmtNum(me.wins), fmtNum(them.wins), cmp(me.wins, them.wins))}
      ${stat('Podiums', fmtNum(me.podiums), fmtNum(them.podiums), cmp(me.podiums, them.podiums))}
      ${stat('Races', fmtNum(me.races), fmtNum(them.races), cmp(me.races, them.races))}
      ${stat('Average safety', num(me.avg_sr, 0).toFixed(2), num(them.avg_sr, 0).toFixed(2), cmp(me.avg_sr, them.avg_sr))}
    </div>`;

  if (!tracks.length) {
    return header + emptyState('Neither crew has a stored lap yet.');
  }

  const sorted = tracks.slice().sort((a, b) => {
    if (activeSort === '_track') return String(a.track).localeCompare(String(b.track));
    return Math.abs(num(b.margin)) - Math.abs(num(a.margin));
  });

  const maxMargin = Math.max(...tracks.map(t => Math.abs(num(t.margin))), 1);

  const head = `<div class="thead">
    <span style="flex:1;margin-left:4px">Track</span>
    <span style="width:118px">${esc(me.tag || 'Yours')}</span>
    <span style="width:118px">${esc(them.tag || 'Rival')}</span>
    <span style="width:104px">Margin</span>
    <span style="width:20px"></span>
  </div>`;

  const rows = sorted.map(t => {
    const a = num(t.my_ms), b = num(t.rival_ms);
    const both = a > 0 && b > 0;
    const ahead = both && a < b;
    const key = 'rv' + t.track;

    const marginCell = !both
      ? `<div class="col"><div class="col-v" style="color:var(--tx-4)">—</div></div>`
      : `<div class="col"><div class="col-v ${ahead ? 'lead' : 'trail'}">${ahead ? '−' : '+'}${(Math.abs(num(t.margin)) / 1000).toFixed(3)}s</div>
           ${bar(Math.abs(num(t.margin)), maxMargin, ahead ? 'var(--green)' : '#ef4444')}</div>`;

    return `<div class="row ${both ? (ahead ? 'r-lead' : 'r-trail') : ''} ${openRow === key ? 'open' : ''}" data-key="${esc(key)}">
      <div class="row-main">
        <div class="who"><div class="who-txt">
          <div class="nm">${esc(t.track || 'Track')}</div>
          <div class="meta">${both ? (ahead ? 'Your crew holds it' : 'Rival crew holds it') : (a ? 'Rival has no time' : 'Your crew has no time')}</div>
        </div></div>
        <div class="col time" style="width:118px"><div class="col-v">${a ? msToLap(a) : '—'}</div></div>
        <div class="col time" style="width:118px"><div class="col-v" style="color:var(--tx-2)">${b ? msToLap(b) : '—'}</div></div>
        ${marginCell}
        <div class="caret">${ICONS.caret}</div>
      </div>
      ${detailCards([
        ['Your best set by', t.my_holder],
        ['Rival best set by', t.rival_holder],
        ['Your crew', a ? msToLap(a) : null],
        ['Rival crew', b ? msToLap(b) : null],
      ])}
    </div>`;
  }).join('');

  return header + head + rows;
}

// ── Invites (incoming) ───────────────────────────────────────────────────────
function renderInvites() {
  const invites = Array.isArray(data.invites) ? data.invites : [];
  if (!invites.length) {
    return emptyState(data.crew
      ? 'No pending invites. Crews can still invite you — you would have to leave this one first.'
      : 'No pending invites. Browse the crews and ask to join one.');
  }

  const blocked = !!data.crew;

  return `<div class="settings">${invites.map(inv => `
    <div class="set-card invite">
      <div class="invite-head">
        ${crewCrest(inv, 'crest-tag')}
        <div class="invite-txt">
          <div class="crest-name">${esc(inv.name || 'Crew')}</div>
          <div class="crest-meta">
            Invited by ${esc(inv.invited_by || 'the owner')}
            · ${fmtNum(inv.members)} member${inv.members === 1 ? '' : 's'}
            ${inv.created_at ? '· ' + esc(String(inv.created_at).slice(0, 10)) : ''}
          </div>
          ${inv.description ? `<div class="invite-desc">${esc(inv.description)}</div>` : ''}
        </div>
        <div class="invite-actions">
          <button class="btn btn-primary" data-accept="${esc(String(inv.id))}" ${blocked ? 'disabled' : ''}>
            ${blocked ? 'Leave your crew first' : 'Accept'}
          </button>
          <button class="btn" data-decline="${esc(String(inv.id))}">Decline</button>
        </div>
      </div>
      ${inv.expires_at ? `<div class="set-hint">Expires ${esc(String(inv.expires_at).slice(0, 10))}</div>` : ''}
    </div>`).join('')}</div>`;
}

// ── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  const crew = data.crew;
  if (!crew) return emptyState('Join or create a crew first.');

  const roster = Array.isArray(data.roster) ? data.roster : [];
  const colour = crew.colour || '#ff6200';

  // Members only get the read-only view; everything editable is owner-gated.
  if (!crew.isOwner) {
    return `
      <div class="settings">
        <div class="set-card">
          <div class="set-title">Crew profile</div>
          <div class="set-hint">Only ${esc(crew.owner || 'the owner')} can change these.</div>
          <div class="detail-grid" style="margin-top:14px">
            ${detailCards([
              ['Name', crew.name],
              ['Tag', crew.tag],
              ['Description', crew.description],
              ['Recruiting', crew.recruiting ? 'Open to new members' : 'Closed'],
              ['Founded', crew.created_at ? String(crew.created_at).slice(0, 10) : null],
              ['Owner', crew.owner],
            ], true)}
          </div>
        </div>

        <div class="set-card danger">
          <div class="set-title">Leave crew</div>
          <div class="set-hint">You will lose the crew tag. A cooldown applies before you can join another.</div>
          <button class="btn btn-danger" id="setLeaveBtn">Leave ${esc(crew.name || 'crew')}</button>
        </div>
      </div>`;
  }

  const others = roster.filter(m => m.pid !== crew.ownerId);
  const outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];

  return `
    <div class="settings">
      <div class="set-card">
        <div class="set-title">Identity</div>
        <div class="set-hint">Name and tag must be unique across the server.</div>

        <div class="set-grid">
          <div>
            <label class="fld-label" for="setName">Crew name</label>
            <input id="setName" class="fld" type="text" maxlength="24" value="${esc(crew.name || '')}" placeholder="Night Runners">
          </div>
          <div class="set-narrow">
            <label class="fld-label" for="setTag">Tag <span class="fld-note">2–4 chars</span></label>
            <input id="setTag" class="fld" type="text" maxlength="4" value="${esc(crew.tag || '')}" placeholder="NR">
          </div>
        </div>

        <label class="fld-label" for="setDesc">Description <span class="fld-note">shown in Browse, max 160</span></label>
        <textarea id="setDesc" class="fld fld-area" maxlength="160" rows="2" placeholder="What your crew is about…">${esc(crew.description || '')}</textarea>

        <button class="btn btn-primary" id="saveIdentity">Save changes</button>
      </div>

      <div class="set-card">
        <div class="set-title">Look</div>
        <div class="set-hint">Crest image and the accent colour used on your crew's rows.</div>

        <div class="set-preview">
          ${crewCrest(crew, 'crest-tag')}
          <div class="set-preview-txt">
            <div class="crest-name">${esc(crew.name || 'Crew')}</div>
            <div class="crest-meta">${crew.image ? 'Custom crest' : 'Using the text tag'}</div>
          </div>
        </div>

        <label class="fld-label" for="setImage">Image link <span class="fld-note">https:// … .png .jpg .gif .webp</span></label>
        <input id="setImage" class="fld" type="text" value="${esc(crew.image || '')}" placeholder="https://cdn.discordapp.com/…/crest.png">

        <label class="fld-label" for="setColour">Accent colour</label>
        <div class="set-colour">
          <input id="setColour" class="fld-colour" type="color" value="${esc(colour)}">
          <input id="setColourHex" class="fld" type="text" maxlength="7" value="${esc(colour)}" placeholder="#ff6200">
        </div>

        <button class="btn btn-primary" id="saveLook">Save look</button>
      </div>

      <div class="set-card">
        <div class="set-head">
          <div>
            <div class="set-title">Recruiting</div>
            <div class="set-hint">Closed crews cannot be joined from the Browse tab.</div>
          </div>
          <button class="toggle ${crew.recruiting ? 'on' : ''}" id="toggleRecruit">
            <i></i><span>${crew.recruiting ? 'Open to new members' : 'Closed'}</span>
          </button>
        </div>
      </div>

      <div class="set-card">
        <div class="set-title">Invites</div>
        <div class="set-hint">Invite a driver who is online and crewless. An invite lets them in even while recruiting is closed, and lapses after a week.</div>

        <div class="set-row">
          <select id="invitePick" class="fld">
            <option value="">${invitable === null ? 'Loading online drivers…' : (invitable.length ? 'Pick a driver…' : 'No crewless drivers online')}</option>
            ${(invitable || []).map(pl => `<option value="${esc(String(pl.pid))}" ${pl.invited ? 'disabled' : ''}>${esc(pl.name)}${pl.invited ? ' — already invited' : ` · ${fmtNum(pl.irating)} iR`}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="sendInvite" ${(invitable || []).length ? '' : 'disabled'}>Send invite</button>
        </div>

        ${outgoing.length ? `
          <div class="set-sep"></div>
          <div class="set-title">Pending (${outgoing.length})</div>
          <div class="invite-list">
            ${outgoing.map(o => `
              <div class="invite-row">
                ${avatar(o.name, o.avatar)}
                <div class="who-txt">
                  <div class="nm">${esc(o.name)}</div>
                  <div class="meta">${o.online ? 'Online' : 'Offline'}${o.irating ? ' · ' + fmtNum(o.irating) + ' iR' : ''}${o.created_at ? ' · sent ' + esc(String(o.created_at).slice(0, 10)) : ''}</div>
                </div>
                <button class="btn btn-sm" data-cancel-invite="${esc(String(o.id))}">Cancel</button>
              </div>`).join('')}
          </div>` : `<div class="set-hint" style="margin-top:12px">No invites waiting on a reply.</div>`}
      </div>

      <div class="set-card danger">
        <div class="set-title">Ownership</div>
        <div class="set-hint">Hand the crew to another member. You stay on as a regular member.</div>
        ${others.length ? `
          <div class="set-row">
            <select id="transferPick" class="fld">
              ${others.map(m => `<option value="${esc(String(m.pid))}">${esc(m.name)}</option>`).join('')}
            </select>
            <button class="btn btn-danger" id="transferBtn">Transfer</button>
          </div>` : `<div class="set-hint">No other members to transfer to.</div>`}

        <div class="set-sep"></div>
        <div class="set-title">Disband</div>
        <div class="set-hint">Removes every member and deletes the crew. This cannot be undone.</div>
        <button class="btn btn-danger" id="setDisbandBtn">Disband ${esc(crew.name || 'crew')}</button>
      </div>
    </div>`;
}

// ── Browse ───────────────────────────────────────────────────────────────────
function renderBrowse() {
  const inCrew = !!data.crew;
  const filtered = filterText
    ? list.filter(c => `${c.name || ''} ${c.tag || ''} ${c.owner || ''}`.toLowerCase().includes(filterText))
    : list;
  const rows = sortRows(filtered);

  searchCount.textContent = filterText ? `${filtered.length}/${list.length}` : '';
  if (!rows.length) {
    return emptyState(filterText ? 'No crew matches that search.' : 'No crews yet — be the first to create one.');
  }

  const maxMembers = maxOf(list, c => c.members);
  const maxPoints  = maxOf(list, c => c.points);

  const head = `<div class="thead">
    <span style="min-width:46px">Tag</span>
    <span style="flex:1;margin-left:10px">Crew</span>
    <span style="width:104px">Members</span>
    <span style="width:104px">Avg iR</span>
    <span style="width:104px">Points</span>
    <span style="width:92px"></span>
    <span style="width:20px"></span>
  </div>`;

  const html = rows.map(c => {
    const key = 'c' + c.id;
    const isMine = data.crew && data.crew.id === c.id;

    return `<div class="row ${isMine ? 'mine' : ''} ${openRow === key ? 'open' : ''}" data-key="${esc(key)}">
      <div class="row-main">
        ${crewCrest(c, 'pos crew-pos')}
        <div class="who">${avatar(c.owner || c.name, c.owner_avatar)}<div class="who-txt">
          <div class="nm">${esc(c.name || 'Crew')}${c.recruiting === false ? ' <span class="pill">Closed</span>' : ''}</div>
          <div class="meta">${c.description ? esc(c.description) : (c.owner ? 'Led by ' + esc(c.owner) : 'No owner')}${isMine ? ' · your crew' : ''}</div>
        </div></div>
        <div class="col"><div class="col-v">${fmtNum(c.members)}</div>${bar(c.members, maxMembers, 'var(--blue)')}</div>
        <div class="col"><div class="col-v">${c.avg_irating ? fmtNum(c.avg_irating) : '—'}</div></div>
        <div class="col"><div class="col-v">${fmtNum(c.points)}</div>${bar(c.points, maxPoints)}</div>
        <div class="col" style="width:92px">
          ${isMine
            ? `<span class="pill">Current</span>`
            : `<button class="btn btn-sm ${inCrew || c.recruiting === false ? '' : 'btn-primary'}"
                 data-join="${esc(String(c.id))}" ${inCrew || c.recruiting === false ? 'disabled' : ''}>${
                   inCrew ? 'In a crew' : c.recruiting === false ? 'Closed' : 'Join'}</button>`}
        </div>
        <div class="caret">${ICONS.caret}</div>
      </div>
      ${detailCards([
        ['Founded', c.created_at ? String(c.created_at).slice(0, 10) : null],
        ['Podiums', c.podiums ? fmtNum(c.podiums) : null],
        ['Best driver rating', c.top_irating ? fmtNum(c.top_irating) : null],
        ['Average safety', c.avg_sr ? num(c.avg_sr).toFixed(2) : null],
        ['Active this week', c.members ? `${fmtNum(c.active_week)} of ${fmtNum(c.members)}` : null],
        ['Points per member', c.members ? fmtNum(Math.round(num(c.points) / c.members)) : null],
      ])}
    </div>`;
  }).join('');

  return head + html;
}

// ── Paint ────────────────────────────────────────────────────────────────────
function render() {
  const tab = TABS[activeTab];
  const inCrew = !!data.crew;

  heroTitle.textContent = activeTab === 'crew' && !inCrew ? 'Create a crew' : tab.title;
  heroSub.textContent = activeTab === 'crew' && !inCrew
    ? 'You are not in a crew yet. Start one, or browse the crews already racing.'
    : tab.sub;

  buildNav();
  buildHeroButtons();

  // The create form and the settings page have nothing to sort or search.
  const showControls = activeTab === 'browse' || (activeTab === 'crew' && inCrew);
  const showSorts = showControls || activeTab === 'rival';   // settings + invites have nothing to sort
  sortSeg.style.display = showSorts ? '' : 'none';
  document.querySelector('.search').classList.toggle('hidden', !showControls);
  if (showSorts) buildSorts();

  body.innerHTML = activeTab === 'rival'    ? renderRival()
                 : activeTab === 'crew'     ? renderCrew()
                 : activeTab === 'settings' ? renderSettings()
                 : activeTab === 'invites'  ? renderInvites()
                 : renderBrowse();

  const count = activeTab === 'rival'   ? ((rival && rival.tracks) || []).length
              : activeTab === 'crew'    ? (data.roster || []).length
              : activeTab === 'invites' ? (data.invites || []).length
              : list.length;
  heroCountL.textContent = tab.unit;
  heroCount.textContent = (showControls || activeTab === 'invites' || activeTab === 'rival') ? fmtNum(count) : '—';
  if (showControls) buildChips(count); else chipbar.innerHTML = '';
  if (!showControls) searchCount.textContent = '';
}

// The crew head-to-head is a heavier read, so it loads when the tab opens.
async function loadRival() {
  rival = (await post('rival')) || {};
  if (activeTab === 'rival') render();
}

// The invite picker is only meaningful for the owner, so it loads lazily.
async function loadInvitable() {
  if (!(data.crew && data.crew.isOwner)) return;
  invitable = await post('invitable');
  if (!Array.isArray(invitable)) invitable = [];
  if (activeTab === 'settings') render();
}

function setTab(tab) {
  if (!TABS[tab] || tab === activeTab) return;
  activeTab = tab;
  activeSort = null;
  filterText = '';
  searchInput.value = '';
  openRow = null;
  render();
  if (tab === 'settings' && invitable === null) loadInvitable();
  if (tab === 'rival' && rival === null) loadRival();
}

// ── Events ───────────────────────────────────────────────────────────────────
railEl.addEventListener('click', e => {
  const b = e.target.closest('.rail-btn'); if (b && b.dataset.tab) setTab(b.dataset.tab);
});

sortSeg.addEventListener('click', e => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  activeSort = b.dataset.sort;
  render();
});

searchInput.addEventListener('input', e => {
  filterText = String(e.target.value || '').trim().toLowerCase();
  render();
  searchInput.focus();
  searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
});

// Row actions and expand/collapse.
body.addEventListener('click', e => {
  const join = e.target.closest('[data-join]');
  if (join) { post('join', { crewId: Number(join.dataset.join) }); return; }

  const kick = e.target.closest('[data-kick]');
  if (kick) { post('kick', { pid: Number(kick.dataset.kick) }); return; }

  if (e.target.closest('#createBtn')) {
    const name = document.getElementById('inName').value.trim();
    const tag  = document.getElementById('inTag').value.trim().toUpperCase();
    if (name.length < 3) return;
    post('create', { name, tag });
    return;
  }

  // Crest button on My crew jumps to the Settings tab.
  if (e.target.closest('#editImgBtn')) { setTab('settings'); return; }

  // ── Settings actions ──
  if (e.target.closest('#saveIdentity')) {
    post('updateSettings', {
      name: document.getElementById('setName').value,
      tag: document.getElementById('setTag').value,
      description: document.getElementById('setDesc').value,
    });
    return;
  }
  if (e.target.closest('#saveLook')) {
    post('updateSettings', {
      image: document.getElementById('setImage').value,
      colour: document.getElementById('setColourHex').value,
    });
    return;
  }
  if (e.target.closest('#toggleRecruit')) {
    post('updateSettings', { recruiting: !(data.crew && data.crew.recruiting) });
    return;
  }
  if (e.target.closest('#transferBtn')) {
    const pick = document.getElementById('transferPick');
    const name = pick.options[pick.selectedIndex]?.text || 'that member';
    if (confirm(`Hand the crew over to ${name}? You stay on as a member.`)) {
      post('transferOwner', { pid: Number(pick.value) });
    }
    return;
  }
  const sendInvite = e.target.closest('#sendInvite');
  if (sendInvite) {
    const pick = document.getElementById('invitePick');
    if (pick && pick.value) post('invite', { pid: Number(pick.value) }).then(() => { invitable = null; loadInvitable(); });
    return;
  }
  const cancelInv = e.target.closest('[data-cancel-invite]');
  if (cancelInv) { post('cancelInvite', { id: Number(cancelInv.dataset.cancelInvite) }); return; }

  const accept = e.target.closest('[data-accept]');
  if (accept) { post('respondInvite', { id: Number(accept.dataset.accept), accept: true }); return; }

  const decline = e.target.closest('[data-decline]');
  if (decline) { post('respondInvite', { id: Number(decline.dataset.decline), accept: false }); return; }

  if (e.target.closest('#setLeaveBtn')) { post('leave'); return; }
  if (e.target.closest('#setDisbandBtn')) {
    if (confirm('Disband the crew for everyone? This cannot be undone.')) post('disband');
    return;
  }

  const main = e.target.closest('.row-main'); if (!main) return;
  const row = main.parentElement;
  const wasOpen = row.classList.contains('open');
  body.querySelectorAll('.row.open').forEach(r => r.classList.remove('open'));
  if (!wasOpen) { row.classList.add('open'); openRow = row.dataset.key; }
  else openRow = null;
});

body.addEventListener('input', e => {
  // Tag fields are uppercase alphanumerics only, on both the create form and
  // the settings page.
  if (e.target.id === 'inTag' || e.target.id === 'setTag') {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prev = document.getElementById('tagPrev');
    if (prev) prev.textContent = e.target.value || '?';
    return;
  }
  // Keep the colour swatch and its hex field in step.
  if (e.target.id === 'setColour') {
    document.getElementById('setColourHex').value = e.target.value;
  } else if (e.target.id === 'setColourHex') {
    const v = e.target.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) document.getElementById('setColour').value = v;
  }
});

heroBtns.addEventListener('click', e => {
  if (e.target.closest('#leaveBtn')) post('leave');
  else if (e.target.closest('#disbandBtn') && confirm('Disband the crew for everyone?')) post('disband');
});

document.getElementById('refreshBtn').addEventListener('click', () => post('refresh'));
document.getElementById('closeBtn').addEventListener('click', () => post('close'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') post('close'); });

// ── Theme (server.cfg spz_theme_* convars, pushed from spz-core) ─────────────
const THEME_VARS = { accent: '--accent', bg: '--bg', bg2: '--bg-card', gold: '--gold' };
const THEME_RGB_VARS = { accent: '--accent-rgb' };
function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}
function applyTheme(theme) {
  if (!theme) return;
  for (const key in THEME_VARS) {
    if (theme[key]) document.documentElement.style.setProperty(THEME_VARS[key], theme[key]);
  }
  for (const key in THEME_RGB_VARS) {
    const rgb = theme[key] && hexToRgbTriplet(theme[key]);
    if (rgb) document.documentElement.style.setProperty(THEME_RGB_VARS[key], rgb);
  }
}

window.addEventListener('message', e => {
  const m = e.data || {};
  if (m.action === 'show') { root.classList.remove('hidden'); render(); }
  else if (m.action === 'hide') root.classList.add('hidden');
  else if (m.action === 'data') { data = m.data || {}; list = m.list || []; invitable = null; rival = null; render(); if (activeTab === 'rival') loadRival(); if (activeTab === 'settings') loadInvitable(); }
  else if (m.action === 'theme') applyTheme(m.theme);
});

// ── Browser preview (no FiveM) ───────────────────────────────────────────────
if (typeof GetParentResourceName !== 'function') {
  const av = n => `https://cdn.discordapp.com/embed/avatars/${n}.png`;
  data = {
    myPid: 1,
    cooldown: 0,
    crew: { id: 3, name: 'Night Runners', tag: 'NR', ownerId: 1, isOwner: true, owner: 'SPICEZ',
      image: 'https://cdn.discordapp.com/embed/avatars/3.png', created_at: '2026-02-14 21:05',
      description: 'Late-night street runs. Class S focus, no contact racing.', colour: '#ff6200', recruiting: true },
    roster: [
      { pid: 1, name: 'SPICEZ',   avatar: av(0), rank: 'Legend', level: 24, irating: 1840, sr: 3.42, points: 12500, races: 60, wins: 42, podiums: 51, playtime: 184000, last_track: 'Downtown GP', last_race_at: 1787000000, owner: true },
      { pid: 2, name: 'ItzSteve', avatar: av(1), rank: 'Pro',    level: 18, irating: 1620, sr: 2.98, points: 9800,  races: 55, wins: 24, podiums: 38, playtime: 121000, last_track: 'Route 68', last_race_at: 1786800000 },
      { pid: 3, name: 'Ghost',    avatar: av(2), rank: 'Pro',    level: 15, irating: 1510, sr: 2.10, points: 8100,  races: 51, wins: 20, podiums: 31, playtime: 98000, last_track: 'Docks Lines', last_race_at: 1786600000 },
      { pid: 4, name: 'Rens',                    rank: 'Racer',  level: 12, irating: 1320, sr: 2.75, points: 6400,  races: 44, wins: 11 },
    ],
  };
  data.outgoing = [
    { id: 11, pid: 7, name: 'FlyWithMe', avatar: 'https://cdn.discordapp.com/embed/avatars/1.png', irating: 1380, online: true,  created_at: '2026-08-26' },
    { id: 12, pid: 9, name: 'BigBob007', irating: 1150, online: false, created_at: '2026-08-22' },
  ];
  data.invites = [
    { id: 21, crew_id: 5, name: 'Vinewood Vipers', tag: 'VV', invited_by: 'Kimberly', members: 7,
      description: 'Casual weekend grid. All classes welcome.', created_at: '2026-08-27', expires_at: '2026-09-03' },
  ];
  invitable = [
    { pid: 7, name: 'FlyWithMe', irating: 1380, invited: true },
    { pid: 12, name: 'Pudge', irating: 1240, invited: false },
    { pid: 15, name: 'n0nameplayer', irating: 1090, invited: false },
  ];
  list = [
    { id: 3, name: 'Night Runners', tag: 'NR', owner: 'SPICEZ', owner_avatar: av(0), image: 'https://cdn.discordapp.com/embed/avatars/3.png', created_at: '2026-02-14', members: 4, avg_irating: 1572, points: 36800, avg_sr: 2.81, podiums: 141, top_irating: 1840, active_week: 3 },
    { id: 5, name: 'Vinewood Vipers', tag: 'VV', owner: 'Kimberly', owner_avatar: av(3), created_at: '2026-04-02', description: 'Casual weekend grid. All classes welcome.', recruiting: true, members: 7, avg_irating: 1420, points: 29500, avg_sr: 2.44, podiums: 96, top_irating: 1610, active_week: 5 },
    { id: 8, name: 'Docks Syndicate', tag: 'DCK', owner: 'Pudge', owner_avatar: av(4), created_at: '2026-06-20', description: 'Docks time-trial specialists.', recruiting: false, members: 3, avg_irating: 1210, points: 11200, avg_sr: 1.92, podiums: 24, top_irating: 1320, active_week: 1 },
  ];
  rival = {"me":{"id":3,"name":"Night Runners","tag":"NR","image":"https://cdn.discordapp.com/embed/avatars/3.png","members":4,"avg_irating":1572,"avg_sr":2.81,"points":36800,"races":210,"wins":97,"podiums":141},"rival":{"id":5,"name":"Vinewood Vipers","tag":"VV","members":7,"avg_irating":1420,"avg_sr":2.44,"points":29500,"races":264,"wins":71,"podiums":96},"head_to_head":{"wins":3,"losses":2,"tracks":6},"tracks":[{"track":"Downtown GP","my_ms":72000,"rival_ms":70250,"my_holder":"SPICEZ","rival_holder":"Kimberly","margin":-1750},{"track":"Docks Lines","my_ms":76300,"rival_ms":78700,"my_holder":"ItzSteve","rival_holder":"Pudge","margin":2400},{"track":"Route 68","my_ms":80600,"rival_ms":83000,"my_holder":"Ghost","rival_holder":"Kimberly","margin":2400},{"track":"Vinewood Loop","my_ms":84900,"rival_ms":83150,"my_holder":"SPICEZ","rival_holder":"FlyWithMe","margin":-1750},{"track":"Airport Sprint","my_ms":89200,"rival_ms":null,"my_holder":"Rens","rival_holder":null,"margin":null},{"track":"Sandy Ridge","my_ms":null,"rival_ms":95900,"my_holder":null,"rival_holder":"Pudge","margin":null}]};
  root.classList.remove('hidden');
  render();
}
