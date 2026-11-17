import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const error = board.querySelector('.error');

/** One <li> per incident id. A refresh moves and adds rows; it never rebuilds them. */
const rows = new Map();

// Viewer's locale and time zone: de-DE prints 16.11.2026, en-NZ 16/11/2026, en-US 11/16/2026.
const localTime = new Intl.DateTimeFormat(navigator.languages, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

function el(tag, props = {}, text = '') {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  node.textContent = text;
  return node;
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

function markAcked(row, reply) {
  row.classList.add('is-acked');
  row.querySelector('[data-testid="ack"]')?.remove();
  const mark = el('span', { 'data-testid': 'acked', class: 'acked' }, 'acked ');
  const at = el('time', { datetime: reply.ackedAt }, localTime.format(new Date(reply.ackedAt)));
  mark.append(at);
  row.append(mark);
}

async function onAck(row, button) {
  button.disabled = true;
  try {
    markAcked(row, await ack(row.dataset.id));
    showError('');
  } catch (cause) {
    button.disabled = false;
    showError(`Ack of ${row.dataset.id} failed: ${cause.message}`);
  }
}

function createRow(incident) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': incident.id, class: `row ${incident.severity}` });
  const button = el('button', { 'data-testid': 'ack', type: 'button' }, 'Ack');
  button.addEventListener('click', () => onAck(row, button));
  row.append(
    el('span', { class: 'id' }, incident.id),
    el('span', { class: 'sev' }, incident.severity),
    el('span', { class: 'what' }, `${incident.service} · ${incident.region} · ${incident.summary}`),
    el('time', { class: 'opened' }),
    button,
  );
  return row;
}

function updateRow(row, incident) {
  const time = row.querySelector('time.opened');
  if (time.dateTime === incident.openedAt) return;
  time.dateTime = incident.openedAt; // the full UTC value stays in the attribute
  time.textContent = localTime.format(new Date(incident.openedAt));
}

function render(incidents) {
  board.querySelector('[data-testid="loader"]')?.remove();

  const current = new Set(incidents.map((incident) => incident.id));
  for (const [id, row] of rows) {
    if (current.has(id)) continue;
    row.remove();
    rows.delete(id);
  }

  // The API answers newest first. Put each row at its index, and move only the rows that are out of place.
  incidents.forEach((incident, index) => {
    let row = rows.get(incident.id);
    if (!row) {
      row = createRow(incident);
      rows.set(incident.id, row);
    }
    updateRow(row, incident);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
  });

  const empty = board.querySelector('[data-testid="empty"]');
  if (incidents.length === 0 && !empty) list.before(el('p', { 'data-testid': 'empty', class: 'note' }, 'No incidents tonight.'));
  if (incidents.length > 0) empty?.remove();
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    showError('');
  } catch (cause) {
    showError(`The board is not current: ${cause.message}`);
  } finally {
    setTimeout(refresh, REFRESH_MS);
  }
}

refresh();
