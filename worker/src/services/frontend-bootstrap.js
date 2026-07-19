function shanghaiDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildForecastBootstrap(day, today = shanghaiDate()) {
  if (!day || day.date !== today || !day.xihu || !day.waitan) return null;
  return {
    today,
    historyAvailable: false,
    minOffset: 0,
    maxOffset: 0,
    fetchedAt: day.capturedAt || null,
    bootstrap: true,
    days: [{
      date: day.date,
      offset: 0,
      recorded: false,
      xihu: day.xihu,
      waitan: day.waitan,
      spots: day.spots || [],
      capturedAt: day.capturedAt || null,
    }],
  };
}

function injectForecastBootstrap(html, bootstrap) {
  if (!bootstrap) return html;
  const json = JSON.stringify(bootstrap)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  return html.replace(
    '<script id="forecast-bootstrap" type="application/json"></script>',
    `<script id="forecast-bootstrap" type="application/json">${json}</script>`,
  );
}

module.exports = { buildForecastBootstrap, injectForecastBootstrap, shanghaiDate };
