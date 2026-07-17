const fs = require('node:fs/promises');
const path = require('node:path');

function addDays(date, amount) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function selectDay(source, index) {
  if (!source || source.error) return source;
  const selected = source.days?.[index];
  if (!selected) return null;
  const { days, ...metadata } = source;
  return { ...metadata, ...selected };
}

function buildLiveDays(xihu, waitan, regional) {
  return (xihu.days || []).map((xihuDay, index) => ({
    date: xihuDay.date,
    offset: index,
    recorded: false,
    xihu: selectDay(xihu, index),
    waitan: selectDay(waitan, index),
    spots: (regional.spots || []).map(spot => selectDay(spot, index)).filter(Boolean),
    capturedAt: new Date().toISOString(),
  }));
}

function historyFile(root, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid history date');
  return path.join(root, `${date}.json`);
}

async function saveHistoryDay(root, day) {
  await fs.mkdir(root, { recursive: true, mode: 0o750 });
  const file = historyFile(root, day.date);
  const temporary = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...day, offset: -1, recorded: true }), { mode: 0o640 });
  await fs.rename(temporary, file);
}

async function loadHistoryDay(root, date) {
  try {
    return JSON.parse(await fs.readFile(historyFile(root, date), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function buildTimeline(xihu, waitan, regional, historyRoot) {
  const liveDays = buildLiveDays(xihu, waitan, regional);
  if (!liveDays.length) throw new Error('No live timeline data');
  await saveHistoryDay(historyRoot, liveDays[0]);

  const yesterdayDate = addDays(liveDays[0].date, -1);
  const yesterday = await loadHistoryDay(historyRoot, yesterdayDate);
  return {
    today: liveDays[0].date,
    historyAvailable: Boolean(yesterday),
    minOffset: yesterday ? -1 : 0,
    maxOffset: liveDays.length - 1,
    days: yesterday ? [{ ...yesterday, offset: -1, recorded: true }, ...liveDays] : liveDays,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  addDays,
  buildLiveDays,
  buildTimeline,
  loadHistoryDay,
  saveHistoryDay,
  selectDay,
};
