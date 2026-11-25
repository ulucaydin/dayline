import {
  dateDistance, dateText, daysFrom, localDate, nextDate, orderTasks, recommendationReasons, spaces,
} from './tasks.js';
import { intakeProviders, recordingMinuteOptions, voiceProviders } from './voice-providers.js';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const scheduleLookahead = 7;
const scheduleDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (character) => entities[character]);

export const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;

export const pages = {
  today: { label: 'Today', icon: 'sun' },
  inbox: { ...spaces.inbox, description: 'A place to put things down and sort them when you’re ready.' },
  upcoming: { label: 'Upcoming', icon: 'calendar-blank', description: 'See what’s scheduled for the days ahead.' },
  completed: { label: 'Completed', icon: 'check-circle', description: 'Everything you’ve checked off.' },
  work: { ...spaces.work, description: 'Projects, follow-ups, and everything else for work.' },
  personal: { ...spaces.personal, description: 'Errands, appointments, and things you want to make time for.' },
};

export function navigation(view, tasks) {
  const inbox = tasks.filter((task) => !task.completedAt && task.space === 'inbox').length;
  const link = (page, mobile = false) => {
    const entry = pages[page];
    const current = view === page ? ' aria-current="page"' : '';
    const count = page === 'inbox' && inbox && !mobile ? `<span class="nav-count">${inbox}</span>` : '';
    return `<a class="${mobile ? 'mobile-link' : 'sidebar-link'}" href="#${page}"${current}>
      <span class="nav-icon ${page === 'work' || page === 'personal' ? page : ''}">${icon(entry.icon)}</span>
      <span>${entry.label}</span>${count}
    </a>`;
  };
  return {
    desktop: `<div class="nav-group">${['today', 'inbox', 'upcoming', 'completed'].map((page) => link(page)).join('')}</div>
      <div class="nav-group space-nav"><h2>Spaces</h2>${['work', 'personal'].map((page) => link(page)).join('')}</div>`,
    mobile: `${link('today', true)}${link('inbox', true)}
      <button class="mobile-link mobile-add" data-action="voice-main" data-voice-control="workspace" data-voice-label="Speak"><span><span class="mic-symbol" aria-hidden="true"></span></span>Speak</button>
      ${link('upcoming', true)}
      <button class="mobile-link" data-action="more" aria-haspopup="dialog"${['work', 'personal', 'completed'].includes(view) ? ' aria-current="page"' : ''}>
        <span>${icon('dots-three')}</span>More
      </button>`,
  };
}

export function pageHeading(view, today) {
  const entry = pages[view];
  if (view === 'today') {
    const date = new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    return `<div class="today-heading">
      <h1 id="page-title" tabindex="-1">${entry.label}</h1>
      <div class="eyebrow">${icon('sun-horizon')} <time datetime="${today}">${escape(date)}</time></div>
    </div>`;
  }
  const eyebrow = `${icon(entry.icon)} <span>${view === 'work' || view === 'personal' ? 'Spaces' : 'Workspace'}</span>`;
  return `<div class="eyebrow">${eyebrow}</div>
    <h1 id="page-title" tabindex="-1">${entry.label}</h1>
    <p>${entry.description}</p>`;
}

function spaceBadge(space) {
  return `<span class="space-badge ${space}"><span aria-hidden="true"></span>${spaces[space].label}</span>`;
}

function scheduleBadge(task, today, view) {
  if (task.completedAt) {
    const date = localDate(new Date(task.completedAt));
    return `<span class="date-chip">${dateText(date, today)}</span>`;
  }
  const timing = (date) => dateText(date, today).replace(/^(Today|Tomorrow|Yesterday)$/, (label) => label.toLowerCase());
  const planned = view === 'schedule' && task.plan && (!task.due || task.plan < task.due)
    ? `<time class="date-chip" datetime="${task.plan}">${icon('calendar-blank')}Planned ${timing(task.plan)}</time>`
    : '';
  if (task.due) {
    const urgent = task.due <= today ? ' due-soon' : '';
    const label = task.due < today ? 'Overdue' : `Due ${timing(task.due)}`;
    return `${planned}<time class="date-chip${urgent}" datetime="${task.due}" title="Due ${escape(task.due)}">${icon('calendar-blank')}${label}</time>`;
  }
  if (planned) return planned;
  if (task.plan && view !== 'today') {
    return `<span class="date-chip">${icon('calendar-blank')}${dateText(task.plan, today)}</span>`;
  }
  return '';
}

export function taskList(tasks, { today, view, label = 'Tasks' }) {
  return `<ul class="task-list" aria-label="${escape(label)}">${tasks.map((task) => {
    const id = escape(task.id);
    const title = escape(task.title);
    const checkText = task.completedAt ? 'Reopen' : 'Complete';
    const details = (action, text, symbol, extra = '') =>
      `<button class="menu-item${extra}" data-action="${action}" data-id="${id}">${icon(symbol)} ${text}</button>`;
    const planAction = task.plan && task.plan <= today
      ? details('unplan', 'Remove from today’s plan', 'minus-circle')
      : details('plan', 'Plan for today', 'sun');
    const highFlag = task.priority === 'high' && !task.completedAt
      ? `<span class="priority-label">${icon('flag')} High priority</span>`
      : '';
    const overdue = view === 'schedule' && task.due && task.due < today;
    return `<li class="task-row${task.completedAt ? ' is-complete' : ''}${overdue ? ' is-overdue' : ''}">
      <label class="task-check">
        <input type="checkbox" data-action="check" data-id="${id}" aria-label="${checkText} ${title}"${task.completedAt ? ' checked' : ''} />
        <span class="check-circle" aria-hidden="true">${icon('check')}</span>
      </label>
      <div class="task-info">
        <button class="task-title" data-action="edit" data-id="${id}">${title}</button>
        <div class="task-meta">
          ${spaceBadge(task.space)}
          ${scheduleBadge(task, today, view)}
          ${task.minutes ? `<span class="estimate">${icon('clock')} ${task.minutes} min</span>` : ''}
          ${highFlag}
        </div>
      </div>
      <div class="task-trailing">
        <button class="icon-button task-voice" data-action="voice-edit" data-id="${id}" aria-label="Update ${title} by voice" title="Update by voice"><span class="mic-symbol" aria-hidden="true"></span></button>
        <details class="popover task-menu">
          <summary class="icon-button" aria-label="Actions for ${title}">${icon('dots-three')}</summary>
          <div class="menu-panel">
            ${task.completedAt ? '' : details('focus', 'Start focus', 'play') + planAction}
            ${details('delete', 'Delete task', 'trash', ' danger')}
          </div>
        </details>
      </div>
    </li>`;
  }).join('')}</ul>`;
}

function filters(activeSpace, sort) {
  const filterButtons = [
    ['all', 'All tasks'], ['work', 'Work'], ['personal', 'Personal'],
  ].map(([value, label]) => `<button data-action="filter" data-value="${value}" aria-pressed="${value === activeSpace}">
    ${value !== 'all' ? `<span class="filter-dot ${value}" aria-hidden="true"></span>` : ''}${label}</button>`).join('');
  return `<div class="task-toolbar"><div class="filters" role="group" aria-label="Filter by space">${filterButtons}</div>${sortControl(sort, 'Sort tasks within each day')}</div>`;
}

function sortControl(sort, label = 'Sort tasks') {
  const options = { smart: 'Smart sort', date: 'Due date', quick: 'Shortest first', newest: 'Newest first' };
  return `<label class="sort-control">
    ${icon(sort === 'smart' ? 'sparkle' : 'sort-ascending')}
    <select id="sort-by" aria-label="${label}">
      ${Object.entries(options).map(([value, label]) => `<option value="${value}"${sort === value ? ' selected' : ''}>${label}</option>`).join('')}
    </select>
    ${icon('caret-down')}
  </label>`;
}

function emptyState(view, activeSpace = 'all') {
  const titles = {
    today: activeSpace === 'all' ? 'Nothing scheduled' : `No ${spaces[activeSpace].label.toLowerCase()} tasks scheduled`,
    inbox: 'Your inbox is clear',
    upcoming: 'Nothing scheduled yet',
    completed: 'No completed tasks yet',
    work: 'No open work tasks',
    personal: 'No open personal tasks',
  };
  const descriptions = {
    today: 'Say what you need to do and when.',
    inbox: 'Quickly capture a task and sort it later.',
    upcoming: 'Give a task a future date to see it here.',
    completed: 'Check off any task to see it here.',
  };
  return `<div class="empty-state">
    <span class="empty-icon">${icon(pages[view].icon)}</span>
    <h3>${titles[view]}</h3>
    <p>${descriptions[view] ?? 'Add a task to this space.'}</p>
  </div>`;
}

function listFooter(hasExamples) {
  return hasExamples ? '<div class="list-footer"><button class="text-button examples-link" data-action="remove-examples">Clear examples</button></div>' : '';
}

function hero(task, { today, energy, count, session, firstTask }) {
  const sameSession = session?.taskId === task?.id && Boolean(task);
  const step = task?.steps.find((item) => !item.done);
  const content = task ? `<div class="hero-recommendation">
    <div class="smart-label">${icon('sparkle')} Suggested next</div>
    <h2 id="focus-suggestion">${escape(task.title)}</h2>
    <div class="hero-meta">
      <span>${icon(spaces[task.space].icon)} ${spaces[task.space].label}</span>
      <span>${icon(task.minutes ? 'clock' : 'sparkle')} ${task.minutes ? `${task.minutes} min` : 'Any duration'}</span>
      ${recommendationReasons(task, today, energy).map((reason) => `<span class="hero-reason">${reason}</span>`).join('')}
    </div>
    ${step ? `<p class="hero-step"><strong>First step</strong> <span>${escape(step.title)}</span></p>` : ''}
    <div class="hero-actions">
      <button class="button primary focus-button" data-action="focus" data-id="${escape(task.id)}">${icon('play')} ${sameSession ? 'Open focus' : 'Start focus'}</button>
      ${count > 1 ? `<button class="button quiet another-button" data-action="another">${icon('arrows-clockwise')} Try another</button>` : ''}
    </div>
  </div>` : '';
  return `<section class="hero${task ? '' : ' hero-empty'}" aria-label="Voice capture${task ? ' and suggested task' : ''}">
    <div class="hero-art" aria-hidden="true"><img src="./assets/focus-tiles.webp" alt="" width="216" height="203" fetchpriority="high" /></div>
    <div class="hero-content">
      ${voiceCapture()}
      ${content}
      ${firstTask ? `<button class="text-button show-examples" data-action="show-examples">Try example tasks</button>` : ''}
    </div>
  </section>`;
}

function voiceCapture(task = false) {
  const surface = task ? 'task' : 'workspace';
  const id = task ? 'voice-task' : 'voice-main';
  const label = task ? 'Update by voice' : 'Talk to Dayline';
  const hint = task ? 'Try “Move it to Friday.”' : 'Say what you want to add or change.';
  return `<div class="voice-capture">
    <button type="button" id="${id}" class="voice-trigger" data-action="${task ? 'voice-task' : 'voice-main'}" data-voice-control="${surface}" data-voice-label="${label}" aria-describedby="${id}-hint">
      <span class="voice-emblem" aria-hidden="true">
        <span class="mic-symbol" aria-hidden="true"></span>
      </span>
      <span class="voice-caption"><span class="voice-label">${label}</span><span id="${id}-hint" class="voice-hint">${hint}</span></span>
    </button>
    <p class="voice-status" data-voice-status="${surface}" role="status" aria-atomic="true"></p>
    ${task ? '' : '<div id="voice-results"></div>'}
  </div>`;
}

function progress(done, open) {
  const total = done + open;
  const percent = total ? Math.round(done / total * 100) : 0;
  const status = open ? `${open} left for today` : total ? 'You’re all caught up' : 'Ready when you are';
  return `<section class="side-card progress-card" aria-labelledby="progress-title">
    <div class="side-heading"><h2 id="progress-title">Today’s progress</h2><span class="panel-icon green">${icon('chart-line-up')}</span></div>
    <div class="progress-body">
      <div class="progress-ring" style="--progress: ${percent}%" aria-hidden="true">
        <span>${percent}<small>%</small></span>
      </div>
      <div class="progress-copy">
        <p><strong>${done} of ${total}</strong> done</p>
        <p>${status}</p>
      </div>
    </div>
  </section>`;
}

function energyCard(energy) {
  return `<section class="side-card energy-card" aria-labelledby="energy-title">
    <div class="side-heading"><h2 id="energy-title">Focus preference</h2><span class="panel-icon lavender">${icon('battery-medium')}</span></div>
    <p>Give quick, light tasks a boost when you’re low on energy.</p>
    <div class="energy-controls" role="group" aria-label="Focus preference">
      <button data-action="energy" data-value="any" aria-pressed="${energy === 'any'}">${icon('list-bullets')} Any task</button>
      <button data-action="energy" data-value="light" aria-pressed="${energy === 'light'}">${icon('feather')} Light tasks</button>
    </div>
  </section>`;
}

function scheduleDay(tasks, offset, { today, energy, sort }) {
  const date = daysFrom(today, offset);
  const label = offset < 2 ? dateText(date, today) : scheduleDateFormat.format(new Date(`${date}T12:00:00`));
  return `<div class="schedule-day" style="--schedule-strength: ${100 - offset * 12}%">
    <h3><time datetime="${date}">${escape(label)}</time></h3>
    ${taskList(orderTasks(tasks, { today, energy, sort }), { today, view: 'schedule', label: `Tasks for ${label}` })}
  </div>`;
}

export function todayPage(state, { today, activeSpace, sort, suggestionId, expanded }) {
  if (state.tasks.length === 0) return hero(null, { firstTask: true });
  const schedule = Array.from({ length: scheduleLookahead + 1 }, () => []);
  for (const task of state.tasks) {
    const date = nextDate(task);
    if (!task.completedAt && date) {
      const offset = Math.max(0, dateDistance(today, date));
      if (offset <= scheduleLookahead) schedule[offset].push(task);
    }
  }
  const allDone = state.tasks.filter((task) => task.completedAt && localDate(new Date(task.completedAt)) === today);
  const matches = (task) => activeSpace === 'all' || task.space === activeSpace;
  const done = allDone.filter(matches).sort((a, b) => b.completedAt - a.completedAt);
  const visible = schedule.map((tasks) => tasks.filter(matches));
  const count = visible.reduce((total, tasks) => total + tasks.length, 0);
  const suggestionQueue = orderTasks(visible[0], { today, energy: state.energy });
  const suggestion = suggestionQueue.find((task) => task.id === suggestionId) ?? suggestionQueue[0];
  const taskDays = visible.map((tasks, offset) => tasks.length
    ? scheduleDay(tasks, offset, { today, energy: state.energy, sort }) : '').join('');
  return `<div class="dashboard-grid">
    <div class="dashboard-main">
      ${hero(suggestion, { today, energy: state.energy, count: suggestionQueue.length, session: state.session })}
      <section class="task-section" aria-labelledby="task-heading">
        <div class="section-title"><h2 id="task-heading">Today &amp; next 7 days</h2><span class="count-pill">${count}</span></div>
        ${filters(activeSpace, sort)}
        <div class="task-panel">
          ${taskDays || emptyState('today', activeSpace)}
          ${listFooter(state.tasks.some((task) => task.sample))}
        </div>
        ${done.length ? `<details class="completed-today"${expanded ? ' open' : ''}>
          <summary>${icon('caret-right')} Completed today <span class="count-pill">${done.length}</span></summary>
          <div class="task-panel">${taskList(done, { today, view: 'today' })}</div>
        </details>` : ''}
      </section>
    </div>
    <aside class="dashboard-side" aria-label="Today’s tools">
      ${progress(allDone.length, schedule[0].length)}
      ${energyCard(state.energy)}
    </aside>
  </div>`;
}

export function collectionPage(state, { view, today, sort }) {
  let tasks = [];
  if (view === 'completed') {
    tasks = state.tasks.filter((task) => task.completedAt).sort((a, b) => b.completedAt - a.completedAt);
  } else if (view === 'upcoming') {
    tasks = state.tasks
      .filter((task) => !task.completedAt && nextDate(task) > today)
      .sort((a, b) => nextDate(a).localeCompare(nextDate(b)));
  } else {
    tasks = orderTasks(state.tasks.filter((task) => !task.completedAt && task.space === view), {
      today, energy: state.energy, sort,
    });
  }
  return `<div class="collection">
    <section class="voice-strip" aria-label="Voice capture">${voiceCapture()}</section>
    <section class="collection-tasks" aria-labelledby="task-heading">
      <div class="collection-header">
        <div class="section-title"><h2 id="task-heading">Tasks</h2><span class="count-pill">${tasks.length}</span></div>
        ${view === 'completed' || view === 'upcoming' ? '' : sortControl(sort)}
      </div>
      <div class="task-panel">
        ${tasks.length ? taskList(tasks, { today, view }) : emptyState(view)}
        ${view === 'completed' ? '' : listFooter(state.tasks.some((task) => task.sample))}
      </div>
    </section>
  </div>`;
}

export function dialogHeading(id, title, subtitle = '') {
  return `<div class="dialog-heading">
    <div><h2 id="${id}">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
    <button class="icon-button" data-action="close" aria-label="Close dialog">${icon('x')}</button>
  </div>`;
}

export function taskDetailsContent(task, today) {
  const timing = (date) => escape(dateText(date, today));
  const metadata = [
    ['Space', spaces[task.space].label],
    ['Priority', task.priority[0].toUpperCase() + task.priority.slice(1)],
    task.due && ['Due', timing(task.due)],
    task.plan && ['Planned', timing(task.plan)],
    task.minutes && ['Estimate', `${task.minutes} min`],
    task.completedAt && ['Status', 'Completed'],
  ].filter(Boolean);
  return `<dl class="task-details-meta">${metadata.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${task.notes ? `<section class="task-detail-section"><h3>Notes</h3><p>${escape(task.notes)}</p></section>` : ''}
    ${task.steps.length ? `<section class="task-detail-section"><h3>Steps</h3><ul>${task.steps.map((step) =>
      `<li${step.done ? ' class="is-done"' : ''}>${icon(step.done ? 'check-circle' : 'circle')} ${escape(step.title)}</li>`).join('')}</ul></section>` : ''}`;
}

export function taskVoiceContent(task, today) {
  return `${dialogHeading('editor-heading', escape(task.title))}
    ${voiceCapture(true)}
    <div id="task-details-body">${taskDetailsContent(task, today)}</div>`;
}

export function voiceResults(entries, choice, today) {
  const meta = (task) => [
    spaces[task.space].label,
    task.due ? `Due ${dateText(task.due, today)}` : task.plan && dateText(task.plan, today),
    task.priority === 'high' && 'High priority',
    task.completedAt && 'Completed',
  ].filter(Boolean).map(escape).join(' · ');
  return `${entries.length ? `<ul class="voice-receipt" aria-label="Latest voice changes">${entries.map(({ task, created }) =>
    `<li><button class="voice-result" data-action="edit" data-id="${escape(task.id)}" aria-label="Open ${escape(task.title)}">
      <span class="voice-result-symbol">${icon('check-circle')}</span>
      <span><strong>${escape(task.title)}</strong><small>${created ? 'Added' : 'Updated'} · ${meta(task)}</small></span>
      ${icon('caret-right')}
    </button></li>`).join('')}</ul>` : ''}
    ${choice.length ? `<div class="voice-choice"><p>Which task should I update?</p>
      <ul class="voice-receipt">${choice.map((task) => `<li><button class="voice-result" data-action="voice-choose" data-id="${escape(task.id)}">
        <span><strong>${escape(task.title)}</strong><small>${meta(task)}</small></span>${icon('caret-right')}
      </button></li>`).join('')}</ul></div>` : ''}`;
}

export function searchResults(tasks, query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = tasks.filter((task) => {
    const haystack = `${task.title} ${task.notes} ${spaces[task.space].label}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || b.updatedAt - a.updatedAt);
  if (!results.length) {
    return `<p class="search-empty" role="status">${terms.length ? 'No matching tasks.' : 'Your tasks will appear here.'}</p>`;
  }
  return `<p class="search-list-label" role="status">${terms.length
    ? `${results.length} ${results.length === 1 ? 'result' : 'results'}${results.length > 20 ? ' · showing 20' : ''}`
    : 'Recent tasks'}</p>
    <ul class="search-results">${results.slice(0, terms.length ? 20 : 6).map((task) => `<li>
      <button class="search-result" data-action="edit" data-id="${escape(task.id)}">
        ${icon(task.completedAt ? 'check-circle' : spaces[task.space].icon)}
        <span>${escape(task.title)}</span>${spaceBadge(task.space)}
      </button>
    </li>`).join('')}</ul>`;
}

export function focusContent(task, session, timeText) {
  const note = task.notes ? `<p class="focus-note">${escape(task.notes)}</p>` : '';
  const steps = task.steps.length ? `<div class="focus-steps"><h3>Small steps</h3>
    <ul>${task.steps.map((step) => `<li><label><input type="checkbox" data-action="step" data-id="${escape(step.id)}"${step.done ? ' checked' : ''} /><span>${escape(step.title)}</span></label></li>`).join('')}</ul>
  </div>` : `<p class="focus-hint">Start with the smallest action you can take.</p>`;
  return `${dialogHeading('focus-heading', 'Focus mode')}
    <div class="focus-task">${spaceBadge(task.space)}<h3>${escape(task.title)}</h3>${note}</div>
    <div class="timer-area">
      <div id="focus-timer" role="timer" aria-label="Time remaining">${timeText}</div>
      <div class="timer-buttons">
        <button class="button secondary" data-action="timer-toggle"></button>
        <button class="icon-button" data-action="timer-reset" aria-label="Reset timer" title="Reset timer">${icon('arrow-counter-clockwise')}</button>
      </div>
      <div class="timer-duration"><label for="timer-length">Session length</label>
        <select id="timer-length">${[...new Set([5, 10, 15, 25, session.duration / 60_000])].sort((a, b) => a - b)
          .map((minutes) => `<option value="${minutes}"${minutes * 60_000 === session.duration ? ' selected' : ''}>${minutes} min</option>`).join('')}</select>
      </div>
    </div>
    ${steps}
    <div class="dialog-actions">
      <button class="button secondary" data-action="close">Back to tasks</button>
      <button class="button primary" data-action="focus-complete" data-id="${escape(task.id)}">${icon('check')} Mark done</button>
    </div>`;
}

function providerSelect(id, label, providers, selected) {
  return `<div class="field"><label for="${id}">${label}</label>
    <select id="${id}" aria-describedby="${id}-help">
      ${Object.entries(providers).map(([value, provider]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${provider.label}</option>`).join('')}
    </select>
    <p id="${id}-help">${providers[selected].description}</p>
  </div>`;
}

function providerKeyForm(provider, label, url) {
  return `<form class="field provider-key-form" data-capture-key="${provider}">
    <div class="provider-key-heading">
      <label for="${provider}-api-key">${label} API key</label>
      <a href="${url}" target="_blank" rel="noopener noreferrer">Get ${label} key</a>
    </div>
    <input id="${provider}-api-key" name="key" type="password" minlength="16" maxlength="512" autocomplete="off" autocapitalize="none" spellcheck="false" required />
    <div class="settings-buttons">
      <button type="submit" class="button secondary">Save key</button>
      <button type="button" class="button quiet" data-action="remove-capture-key" hidden>Remove key</button>
    </div>
    <p data-key-status role="status"></p>
  </form>`;
}

export function settingsContent(state, shortcut, syncMessage) {
  const examples = state.tasks.some((task) => task.sample);
  return `${dialogHeading('settings-heading', 'Settings')}
    <div class="settings-section capture-settings">
      <h3>Task capture</h3>
      <div class="capture-choices">
        ${providerSelect('voice-provider', 'Transcriber', voiceProviders, state.voiceProvider)}
        ${providerSelect('intake-provider', 'Task interpretation', intakeProviders, state.intakeProvider)}
        <div class="field"><label for="recording-limit">Maximum recording time</label>
          <select id="recording-limit">${recordingMinuteOptions.map((minutes) =>
            `<option value="${minutes}"${minutes === state.recordingMinutes ? ' selected' : ''}>${minutes} ${minutes === 1 ? 'minute' : 'minutes'}</option>`).join('')}</select>
        </div>
      </div>
      <details class="provider-keys">
        <summary>${icon('caret-right')} API keys</summary>
        <p id="capture-key-availability" role="status">Checking key storage…</p>
        <div id="capture-key-forms" hidden>
          ${providerKeyForm('openai', 'OpenAI', 'https://platform.openai.com/api-keys')}
          ${providerKeyForm('gemini', 'Gemini', 'https://aistudio.google.com/api-keys')}
        </div>
      </details>
    </div>
    <div class="settings-section">
      <h3>Focus timer</h3>
      <div class="field"><label for="default-length">Default session length</label>
        <select id="default-length">${[5, 10, 15, 25].map((minutes) => `<option value="${minutes}"${minutes === state.focusMinutes ? ' selected' : ''}>${minutes} minutes</option>`).join('')}</select>
      </div>
    </div>
    <div class="settings-section">
      <h3>Voice and shortcuts</h3>
      <p>Try <code>Send the recap by Tuesday</code> or <code>Move the recap to Friday</code>.</p>
      <dl class="shortcuts">
        <div><dt>Start voice capture</dt><dd><kbd>N</kbd></dd></div>
        <div><dt>Search tasks</dt><dd><kbd>${shortcut}</kbd></dd></div>
        <div><dt>Close dialog</dt><dd><kbd>Esc</kbd></dd></div>
      </dl>
    </div>
    <div class="settings-section">
      <h3>Your data</h3>
      <p id="sync-status" role="status">${escape(syncMessage)}</p>
      <div class="settings-buttons">
        <button class="button secondary" data-action="export">${icon('download-simple')} Export tasks</button>
        <button class="button secondary" data-action="import">${icon('upload-simple')} Import tasks</button>
        ${examples ? `<button class="button secondary" data-action="remove-examples">${icon('broom')} Clear examples</button>` : ''}
      </div>
    </div>`;
}

export function moreContent(view) {
  return `${dialogHeading('more-heading', 'Workspace')}
    <nav class="more-links" aria-label="Other views">${['work', 'personal', 'completed'].map((page) =>
      `<a class="sidebar-link" href="#${page}" data-action="mobile-route"${page === view ? ' aria-current="page"' : ''}>${icon(pages[page].icon)} ${pages[page].label}</a>`).join('')}</nav>
    <div class="more-links">
      <button class="sidebar-link" data-action="install">${icon('download-simple')} Install app</button>
      <button class="sidebar-link" data-action="settings">${icon('gear')} Settings</button>
    </div>`;
}

export function installContent(standalone) {
  return `${dialogHeading('install-heading', standalone ? 'Dayline is installed' : 'Install Dayline')}
    <div class="install-copy">
      ${standalone ? '<p>Open Dayline from your device’s app list or home screen.</p>' : `
        <p>Open Dayline in your device’s browser and use its install menu to keep it handy.</p>
        <dl>
          <div><dt>Mac</dt><dd>In Safari, choose <strong>File → Add to Dock</strong>. In Chrome, use the install icon in the address bar or the browser menu.</dd></div>
          <div><dt>Windows</dt><dd>In Chrome or Edge, use the install icon in the address bar or the browser menu.</dd></div>
          <div><dt>Android</dt><dd><a class="button secondary" href="./download/Dayline.apk" download>${icon('download-simple')} Download Android APK</a></dd></div>
        </dl>`}
    </div>
    <div class="dialog-actions"><button class="button primary" data-action="close">Done</button></div>`;
}
