// @ts-check
/** @param {Date} d */
function ymdFromDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayList(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00Z`);
  const to = new Date(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
  const total = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const out = [];
  for (let i = 0; i < total; i += 1) out.push(ymdFromDate(new Date(from.getTime() + i * 86400000)));
  return out;
}

function candleWindow(period, bounds, today) {
  const toDay = (bounds && bounds.toDay) || today || '';
  let fromDay = (bounds && bounds.fromDay) || toDay;
  if (!toDay) return { fromDay: '', toDay: '' };
  if (period === 'day') return { fromDay: toDay, toDay };
  const days = dayList(fromDay, toDay);
  if (days.length > 31) fromDay = days[days.length - 31];
  return { fromDay, toDay };
}

function dayAgeDays(day, today) {
  const a = new Date(`${day}T00:00:00Z`);
  const b = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return -1;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
