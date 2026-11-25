const svg = document.querySelector('#elo-plot');
const stage = document.querySelector('#plot-stage');
const scroller = document.querySelector('#plot-scroll');
const tooltip = document.querySelector('#plot-tooltip');
const selection = document.querySelector('#selection');
const selectionContent = document.querySelector('#selection-content');
const clearButton = document.querySelector('#clear-selection');
const touchOnly = matchMedia('(hover: none)');
const { policies, benchmarks, eras, forecast } = figureData;

const width = 1060;
const height = width * 9 / 16;
const plot = { left: 38, right: 999, top: 47, bottom: height - 37 };
const firstYear = 2022.75;
const eloMax = 4400;
const x = year => plot.left + (year - firstYear) * (plot.right - plot.left) / (forecast.end - firstYear);
const y = elo => plot.bottom - elo * (plot.bottom - plot.top) / eloMax;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const elo = value => `${number.format(value)} Elo`;
const range = ([lo, hi]) => `${number.format(lo)}–${number.format(hi)} Elo`;
const month = value => {
  const year = Math.floor(value);
  const start = Date.UTC(year, 0, 1);
  return monthFormat.format(new Date(start + (value - year) * (Date.UTC(year + 1, 0, 1) - start)));
};
const readableDate = value => (value.length > 7 ? dateFormat : monthFormat).format(new Date(value));
// Two periods split at G0.5 (June 2026), where the SOTA pace changes most (the paper's Fig. 1 since 2026-11-25).
const periodNames = ['Before G0.5', 'Since G0.5'];
const kindLabel = { VLA: 'VLA', WAM: 'WAM', agent: 'LLM Agent', external: 'Claude · inferred placement' };
const color = { blue: '#2455ad', marker: '#6883b8', teal: '#287c83' };
const violinColors = ['#6aafb4', '#4c9ba2', '#41929a', '#37838a', '#277981'];
const targets = [];
const policyTargets = [];
let preview = null;
let pinned = null;
let lastFocus = null;

function element(name, attrs = {}, content, parent = svg) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  parent.appendChild(node);
  return node;
}

function line(x1, y1, x2, y2, attrs, parent) {
  return element('line', { x1, y1, x2, y2, ...attrs }, undefined, parent);
}

function label(text, cx, cy, className, anchor = 'middle', parent = svg) {
  return element('text', { x: cx, y: cy, class: className, 'text-anchor': anchor }, text, parent);
}

function path(points, attrs, parent) {
  const coordinates = points.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(' L');
  const { closed, ...style } = attrs;
  return element('path', { d: `M${coordinates}${closed ? ' Z' : ''}`, ...style }, undefined, parent);
}

function target(id, position, describe, parent) {
  const info = describe(position[0]);
  const group = element('g', {
    class: 'chart-item', role: 'button', tabindex: '-1', 'data-item': id,
    'aria-label': `${info.title}, ${info.summary}`, 'aria-pressed': 'false',
  }, undefined, parent);
  const item = { group, position, describe };
  targets.push(item);
  return item;
}

function drawAxes() {
  const mobileScale = document.querySelector('#mobile-scale');
  mobileScale.setAttribute('viewBox', `0 0 48 ${height}`);
  const edges = [firstYear, ...eras.breaks, forecast.cutoff, forecast.end];
  const periods = ['before', 'since', 'forecast'];
  periods.forEach((period, index) => {
    const left = x(edges[index]);
    const right = x(edges[index + 1]);
    element('rect', { x: left, y: plot.top, width: right - left, height: plot.bottom - plot.top, class: `plot-background ${period}` });
    if (index > 0) line(left, plot.top, left, plot.bottom, { class: 'era-divider' });
  });

  label('Capability / difficulty (Elo)', width - 4, 14, 'axis-title right-scale', 'end');
  label('Elo', 36, 36, 'axis-title', 'end', mobileScale);
  for (const level of [1000, 2000, 3000, 4000]) {
    line(plot.left, y(level), plot.right, y(level), { class: 'axis-grid' });
    label(number.format(level), width - 4, y(level) + 4, 'axis-label right-scale', 'end');
    label(number.format(level), 43, y(level) + 4, 'axis-label', 'end', mobileScale);
  }
  line(plot.left, plot.bottom, plot.right, plot.bottom, { class: 'axis-base' });
  for (let year = 2023; year <= 2029; year += 1) {
    line(x(year), plot.bottom, x(year), plot.bottom + 5, { class: 'axis-base' });
    label(year, x(year), plot.bottom + 22, 'axis-label');
  }
}

function drawBenchmarks() {
  benchmarks.forEach((benchmark, index) => {
    const center = x(benchmark.year);
    const half = Math.abs(x(benchmark.year + .145) - center);
    const left = benchmark.side !== 'right';
    const right = benchmark.side !== 'left';
    const tint = violinColors[index];
    const describe = () => ({
      title: benchmark.name,
      summary: `Median difficulty ${elo(benchmark.median)} · ${benchmark.count} test cases`,
      notes: [`Released ${readableDate(benchmark.date)}. The 10th–90th percentile of task difficulty spans ${range(benchmark.quantiles)}.`,
        'The violin’s width shows where test cases concentrate on the Elo scale.'],
    });
    const { group } = target(`benchmark-${index}`, [center + (right - left) * half / 2, y(benchmark.median)], describe);
    const wing = direction => benchmark.density.map(([score, w]) => [x(benchmark.year + direction * w), y(score)]);
    const leftWing = wing(left ? -1 : 0);
    const rightWing = wing(right ? 1 : 0).reverse();
    path([...leftWing, ...rightWing], { closed: true, class: 'benchmark-shape', fill: tint, 'fill-opacity': '.17', stroke: tint, 'stroke-width': '1.35' }, group);
    const medianY = y(benchmark.median);
    for (const [stroke, strokeWidth] of [['#fff', 3.5], [tint, 1.45]]) {
      line(center - (left ? half : 0), medianY, center + (right ? half : 0), medianY,
        { stroke, 'stroke-width': strokeWidth, 'pointer-events': 'none' }, group);
    }
    const top = y(benchmark.density.at(-1)[0]);
    if (benchmark.side === 'both') {
      let labelY = top - 10;
      if (benchmark.id === 'LIBERO') {
        const [[firstYear, firstElo], [lastYear, lastElo]] = eras.nodes;
        const progress = (benchmark.year - firstYear) / (lastYear - firstYear);
        const frontierY = y(firstElo + progress * (lastElo - firstElo));
        labelY = Math.min(labelY, frontierY - 10);
      }
      label(benchmark.name, center, labelY, 'benchmark-label target-label', 'middle', group);
    } else {
      const clean = benchmark.side === 'left';
      const twinTop = y(benchmarks[3].density.at(-1)[0]);
      label(clean ? 'clean' : 'rand.', center + (clean ? -6 : 6), twinTop - 10, 'benchmark-label benchmark-sub target-label', clean ? 'end' : 'start', group);
      if (!clean) label('RoboTwin 2.0', center, twinTop - 27, 'benchmark-label target-label', 'middle', group);
    }
  });
}

function drawFrontier() {
  const points = eras.nodes.map(([year, score]) => [x(year), y(score)]);
  const style = { fill: 'none', stroke: color.blue, 'stroke-width': 2.5, 'stroke-linecap': 'round' };
  const vlaHighlight = path(points.slice(0, 2), {
    ...style, 'stroke-width': 12, 'stroke-opacity': .19, 'stroke-linejoin': 'round',
    opacity: 0, 'pointer-events': 'none', 'aria-hidden': 'true',
  });
  path(points, { ...style, 'stroke-linejoin': 'round', 'pointer-events': 'none' });

  const dateSpan = start => `${month(eras.nodes[start][0])} to ${month(eras.nodes[start + 1][0])}`;
  function addSegment(id, start, describe) {
    const [from, to] = points.slice(start, start + 2);
    const segment = [from, to];
    const center = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const item = target(id, center, describe);
    const { group } = item;
    item.highlightVla = start === 0;
    if (!item.highlightVla) {
      path(segment, { ...style, class: 'line-highlight', 'stroke-width': 12, 'stroke-opacity': .19 }, group);
    }
    path(segment, { ...style, stroke: 'transparent', 'stroke-width': 14, class: 'frontier-hit' }, group);
    return group;
  }

  // One continuous line through RT-1, G0.5 and the latest SOTA: it bends once, at G0.5, where the SOTA pace changes
  // most. The first period's pace runs from RT-1 to G0.5, the second from G0.5 to the latest SOTA. As in the paper's
  // Fig. 1, the two periods carry no names above the plot (only the forecast does).
  const speedUp = eras.rates[1] / eras.rates[0];
  periodNames.forEach((name, index) => {
    const start = index;
    const last = index === periodNames.length - 1;
    addSegment(`frontier-${index}`, start, () => ({
      title: `SOTA · ${name.toLowerCase()}`,
      summary: `+${elo(eras.rates[index])} per year`,
      preview: dateSpan(start),
      notes: [last
        ? `The pace runs from G0.5 to the latest SOTA policy (${dateSpan(start)}), about ${number.format(speedUp)} times the pace before G0.5.`
        : `The pace runs from RT-1 to G0.5 (${dateSpan(start)}). The line bends at G0.5, where the SOTA pace changes most.`],
    }));
  });
  return vlaHighlight;
}

function drawForecast() {
  const predicted = (year, pace = forecast.pace) => forecast.y + (year - forecast.x) * pace;
  const lineEnd = Math.min(forecast.end, forecast.x + (eloMax - forecast.y) / forecast.pace);
  const pointAt = year => [x(year), y(predicted(year))];
  for (const [bounds, band] of [[forecast.tasksAndPolicies, 'outer'], [forecast.tasks, 'inner']]) {
    const years = Array.from({ length: 100 }, (_, index) => forecast.x + index * (forecast.end - forecast.x) / 99);
    const edge = pace => years.map(year => [x(year), y(Math.min(eloMax, predicted(year, pace)))]);
    path([...edge(bounds[0]), ...edge(bounds[1]).reverse()], { closed: true, class: `forecast-band ${band}`, 'pointer-events': 'none' });
  }

  const item = target('forecast', pointAt(forecast.crossing), px => {
    const ratio = (clamp(px, x(forecast.x), x(lineEnd)) - x(forecast.x)) / (x(lineEnd) - x(forecast.x));
    const year = forecast.x + ratio * (lineEnd - forecast.x);
    const inner = range(forecast.tasks.map(pace => predicted(year, pace)));
    const outer = range(forecast.tasksAndPolicies.map(pace => predicted(year, pace)));
    return {
      title: `SOTA forecast · ${month(year)}`,
      summary: elo(predicted(year)),
      preview: `95% interval: ${outer}`,
      notes: [`95% intervals: ${inner} with tasks resampled, and ${outer} with both tasks and policies resampled.`,
        `The dashed line extends the pace since G0.5, +${elo(forecast.pace)} per year, from the final observed SOTA policy.`],
    };
  });
  const { group } = item;
  const segment = [pointAt(forecast.x), pointAt(lineEnd)];
  const style = { fill: 'none', stroke: color.blue, 'stroke-width': 2.5, 'stroke-dasharray': '7 5', 'stroke-linecap': 'round' };
  path(segment, { ...style, class: 'line-highlight', 'stroke-dasharray': 'none', 'stroke-width': 11, 'stroke-opacity': .24 }, group);
  path(segment, style, group);
  path(segment, { ...style, stroke: 'transparent', 'stroke-dasharray': 'none', 'stroke-width': 23, class: 'forecast-hit' }, group);
  label('FORECAST', (x(forecast.cutoff) + plot.right) / 2, 35, 'era-label target-label', 'middle', group);
  const marker = element('circle', { cx: item.position[0], cy: item.position[1], r: 5.5, fill: color.blue, stroke: '#fff', 'stroke-width': 2, class: 'halo' }, undefined, group);
  item.track = px => {
    const year = firstYear + (clamp(px, x(forecast.x), x(lineEnd)) - plot.left) * (forecast.end - firstYear) / (plot.right - plot.left);
    return pointAt(year);
  };
  item.marker = marker;
}

function drawAnnotations() {
  const [min, max] = forecast.needed;
  const levelY = y(min);
  const forecastX = x(forecast.crossing);
  const guideX = x(benchmarks.at(-1).year + .2);
  const explainCrossing = () => ({
    title: 'RoboDojo’s saturation threshold',
    summary: `${elo(min)} · projected ${month(forecast.crossing)}`,
    notes: ['At this threshold, the SOTA policy reaches at least 50% expected score on 90% of RoboDojo’s test cases.',
      `The 95% interval for the projected crossing is ${forecast.crossingInterval.map(month).join(' to ')}.`],
  });
  const guide = target('robodojo-threshold', [forecastX, levelY], explainCrossing);
  line(guideX, levelY, plot.right, levelY, { stroke: '#7894ab', 'stroke-dasharray': '4 4', class: 'threshold-line' }, guide.group);
  line(guideX, levelY, plot.right, levelY, { stroke: 'transparent', 'stroke-width': '12' }, guide.group);
  label('RoboDojo 90th percentile', plot.right - 8, levelY - 8, 'threshold-label target-label', 'end', guide.group);
  element('circle', { cx: forecastX, cy: levelY, r: 7, fill: 'none', stroke: '#7894ab', 'stroke-width': 2, class: 'halo' }, undefined, guide.group);

  const { group } = target('desired-benchmark', [forecastX, (y(max) + levelY) / 2], () => ({
    title: 'Desired benchmark',
    summary: range(forecast.needed),
    notes: [`If it launches around ${month(forecast.crossing)}, this is the difficulty range needed to keep distinguishing SOTA policies for one more year at the pace since G0.5.`],
  }));
  // dashed stem with solid caps in the SOTA blue, as the paper's Fig. 1 draws the desired benchmark (2026-11-25)
  const stem = { stroke: color.blue, 'stroke-width': 2, 'stroke-linecap': 'butt' };
  line(forecastX, y(max), forecastX, levelY, { ...stem, class: 'line-highlight', 'stroke-width': 12, 'stroke-opacity': .22 }, group);
  line(forecastX, y(max), forecastX, levelY, { ...stem, 'stroke-dasharray': '5 3' }, group);
  line(forecastX, y(max), forecastX, levelY, { stroke: 'transparent', 'stroke-width': 20 }, group);
  line(forecastX - 5, y(max), forecastX + 5, y(max), stem, group);
  line(forecastX - 5, levelY, forecastX + 5, levelY, stem, group);
  label('Desired benchmark', forecastX, y(max) - 10, 'annotation-label target-label', 'middle', group);
}

function drawPolicies() {
  const labels = {
    RT_1: [8, -10, 'start'], Pi_05: [-5, -11, 'end'], G05: [-12, -9, 'end'],
    WallX: [31, 15, 'start'], 'Fable 5.2': [8, -8, 'start'],
  };
  const ordered = [...policies].sort((a, b) => Number(Boolean(a.record)) - Number(Boolean(b.record)));
  for (const policy of ordered) {
    const cx = x(policy.year);
    const cy = y(policy.elo);
    const external = policy.kind === 'external';
    const describe = () => {
      const status = policy.record ? ' · SOTA at release' : '';
      const notes = [`${kindLabel[policy.kind]} · Released ${readableDate(policy.date)}.`];
      if (external) {
        notes.push(`Placed on the existing scale using Anthropic’s reported RoboDojo score of ${(policy.benchmarkScore * 100).toFixed(1)}% (setting-specific level: ${elo(policy.benchmarkLevel)}). Excluded from fitting, the historical trend, and the forecast.`);
      } else {
        if (policy.interval) notes.push(`95% interval for general capability: ${range(policy.interval)}.`);
        notes.push(`Evaluated on ${policy.benchmarks.join(', ')}.`);
      }
      return { title: policy.name, summary: `${elo(policy.elo)}${external ? ' · inferred' : status}`, notes };
    };
    const item = target(`policy-${policy.id}`, [cx, cy], describe);
    policyTargets.push(item);
    const { group } = item;
    const fill = policy.record ? color.blue : color.marker;
    const r = policy.record ? 4.25 : 3.45;
    element('circle', { cx, cy, r: 9, fill: '#d4e4fa', stroke: color.blue, 'stroke-width': 1, class: 'halo' }, undefined, group);
    element('circle', { cx, cy, r: 7, fill: 'transparent', class: 'policy-hit' }, undefined, group);
    const attrs = { fill, stroke: '#fff', 'stroke-width': 1.05, 'pointer-events': 'none' };
    if (policy.kind === 'VLA') element('circle', { cx, cy, r, ...attrs }, undefined, group);
    else if (policy.kind === 'WAM') element('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, rx: .6, ...attrs }, undefined, group);
    else path([[cx, cy - r - 1], [cx + r + .6, cy + r - .1], [cx - r - .6, cy + r - .1]],
      { closed: true, ...attrs, ...(external ? { fill: '#fff', stroke: color.marker, 'stroke-width': 1.45 } : {}) }, group);

    if (labels[policy.id]) {
      const [dx, dy, anchor] = labels[policy.id];
      if (policy.id === 'WallX') line(cx + 4, cy + 3, cx + dx - 5, cy + dy - 3, { stroke: '#8191a8', 'stroke-width': .9 }, group);
      label(policy.name, cx + dx, cy + dy, 'policy-label target-label', anchor, group);
    }
  }
}

function localPoint(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
}

function nearestPolicy(point, fallback) {
  let best = fallback;
  let bestDistance = Infinity;
  for (const item of policyTargets) {
    const [px, py] = item.position;
    const distance = (px - point.x) ** 2 + (py - point.y) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function hit(item, event) {
  const eventTarget = event?.target;
  if (eventTarget?.classList.contains('policy-hit')) item = nearestPolicy(localPoint(event), item);
  const moving = item.track && eventTarget?.classList.contains('forecast-hit');
  const position = moving ? item.track(localPoint(event).x) : item.position;
  return { item, position, info: item.describe(position[0]) };
}

function highlight() {
  const active = preview || pinned;
  vlaFrontierHighlight.setAttribute('opacity', active?.item.highlightVla ? 1 : 0);
  for (const item of targets) {
    item.group.classList.toggle('is-active', item === active?.item);
    if (item.marker && item === active?.item) {
      item.marker.setAttribute('cx', active.position[0]);
      item.marker.setAttribute('cy', active.position[1]);
    }
  }
}

function writeInfo(container, info, expanded) {
  const title = document.createElement(expanded ? 'h3' : 'strong');
  title.textContent = info.title;
  const value = document.createElement(expanded ? 'p' : 'span');
  value.className = 'detail-value';
  value.textContent = info.summary;
  container.replaceChildren(title, value);
  if (expanded) {
    for (const text of info.notes) {
      const note = document.createElement('p');
      note.className = 'detail-note';
      note.textContent = text;
      container.appendChild(note);
    }
  } else if (info.preview) {
    const context = document.createElement('span');
    context.textContent = info.preview;
    container.appendChild(context);
  }
}

function positionTooltip(result) {
  const shellRect = tooltip.parentElement.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const [px, py] = result.position;
  let screenX = svgRect.left - shellRect.left + px * svgRect.width / width;
  const screenY = svgRect.top - shellRect.top + py * svgRect.height / height;
  screenX = clamp(screenX, 0, shellRect.width);
  const left = clamp(screenX + 13, 0, Math.max(0, shellRect.width - tooltip.offsetWidth));
  const above = screenY - tooltip.offsetHeight - 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above < 0 ? screenY + 12 : above}px`;
}

function showPreview(result) {
  preview = result;
  highlight();
  writeInfo(tooltip, result.info, false);
  tooltip.hidden = false;
  positionTooltip(result);
}

function hidePreview() {
  preview = null;
  tooltip.hidden = true;
  highlight();
}

function pin(result, reveal) {
  pinned?.item.group.setAttribute('aria-pressed', 'false');
  pinned = result;
  hidePreview();
  selection.hidden = !result;
  if (!result) {
    selectionContent.replaceChildren();
    return;
  }
  result.item.group.setAttribute('aria-pressed', 'true');
  writeInfo(selectionContent, result.info, true);
  if (reveal && selection.getBoundingClientRect().bottom > window.innerHeight) {
    selection.scrollIntoView({ block: 'nearest' });
  }
}

function useRovingFocus(item, focus = false) {
  lastFocus?.group.setAttribute('tabindex', '-1');
  lastFocus = item;
  item.group.setAttribute('tabindex', '0');
  if (focus) item.group.focus();
}

function enableInteractions() {
  targets.sort((a, b) => a.position[0] - b.position[0] || a.position[1] - b.position[1]);
  useRovingFocus(targets[0]);
  for (const item of targets) {
    const { group } = item;
    group.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showPreview(hit(item, event));
    });
    group.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (item.track || event.target.classList.contains('policy-hit') || preview?.item !== item) {
        const result = hit(item, event);
        if (result.item !== preview?.item || item.track) showPreview(result);
      }
    });
    group.addEventListener('pointerleave', hidePreview);
    group.addEventListener('focus', () => {
      useRovingFocus(item);
      if (group.matches(':focus-visible')) showPreview(hit(item));
    });
    group.addEventListener('blur', hidePreview);
    group.addEventListener('click', event => {
      const result = hit(item, event);
      useRovingFocus(result.item);
      pin(result, event.pointerType === 'touch' || touchOnly.matches);
    });
    group.addEventListener('keydown', event => {
      const index = targets.indexOf(item);
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          useRovingFocus(targets[(index + 1) % targets.length], true);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          useRovingFocus(targets[(index + targets.length - 1) % targets.length], true);
          break;
        case 'Home':
          useRovingFocus(targets[0], true);
          break;
        case 'End':
          useRovingFocus(targets.at(-1), true);
          break;
        case 'Enter':
        case ' ':
          pin(hit(item), true);
          break;
        case 'Escape':
          pin(null);
          break;
        default:
          return;
      }
      event.preventDefault();
    });
  }
  clearButton.addEventListener('click', () => {
    const item = pinned?.item;
    const restoreFocus = clearButton.matches(':focus-visible');
    pin(null);
    if (item && restoreFocus) useRovingFocus(item, true);
  });
  scroller.addEventListener('scroll', () => {
    if (preview) positionTooltip(preview);
  }, { passive: true });
  new ResizeObserver(() => {
    if (preview) positionTooltip(preview);
  }).observe(stage);

  const setHint = () => { document.querySelector('#pointer-hint').textContent = touchOnly.matches ? 'Tap a point, benchmark, or line' : 'Hover to explore · Click to pin'; };
  setHint();
  touchOnly.addEventListener('change', setHint);
}

svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
element('title', { id: 'plot-title' }, 'Robot policy progress and benchmark difficulty over time');
element('desc', { id: 'plot-description' }, 'Interactive chart of 44 fitted policies, three inferred Claude placements, four benchmark difficulty distributions, the SOTA line, which bends once at G0.5 in June 2026, and its forecast with uncertainty through 2029.');
drawAxes();
drawForecast();
drawBenchmarks();
const vlaFrontierHighlight = drawFrontier();
drawAnnotations();
drawPolicies();
enableInteractions();

const copyButton = document.querySelector('#copy-bibtex');
const bibtex = document.querySelector('#bibtex-text');
const copyStatus = document.querySelector('#copy-status');
let copyTimer;

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(bibtex.textContent);
    copyButton.textContent = 'Copied';
    copyStatus.textContent = 'BibTeX copied to clipboard.';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyButton.textContent = 'Copy BibTeX'; }, 1800);
  } catch {
    const selectedText = document.createRange();
    selectedText.selectNodeContents(bibtex);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(selectedText);
    copyStatus.textContent = 'BibTeX selected. Use your browser’s Copy command.';
  }
});
