// The 24h scale under the plasma band: real UTC hour labels for the
// -24/-18/-12/-6 marks, refreshed each minute so the axis stays truthful.

function two(n) {
  return String(n).padStart(2, '0');
}

export function initTimelineScale(container) {
  if (!container) return;
  const labels = container.querySelectorAll('[data-hours-ago]');

  const update = () => {
    const now = new Date();
    for (const label of labels) {
      const hoursAgo = Number(label.dataset.hoursAgo);
      const at = new Date(now.getTime() - hoursAgo * 3600_000);
      label.textContent = two(at.getUTCHours()) + ':00';
    }
  };

  update();
  const timer = setInterval(update, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
}
