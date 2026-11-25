import '@fontsource-variable/dm-sans/wght.css';
import './icons.css';
import './style.css';
import { getCaptureAvailability, updateCaptureKey } from './capture-api.js';
import { createVoiceControls } from './dictation.js';
import { intakeProviders, voiceProviders } from './voice-providers.js';
import {
  initialState, isToday, isWorkspaceChange, localDate, makeBackup, makeTask, mergeTasks,
  newId, orderTasks, parseBackup, readState, sampleTasks, saveState,
} from './tasks.js';
import { isVoiceReference, matchVoiceTasks, parseVoiceTasks } from './voice-tasks.js';
import { applyTaskSync, newSyncState, trackTaskChanges } from './task-sync-state.js';
import { startTaskSync, syncMessages } from './task-sync.js';
import {
  collectionPage, focusContent, icon, installContent, moreContent, navigation,
  pageHeading, pages, searchResults, settingsContent, taskDetailsContent, taskVoiceContent, todayPage, voiceResults,
} from './views.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const main = $('#page-content');
const toast = $('#toast');
const editor = $('#editor');
const search = $('#search');
const focus = $('#focus');
const settings = $('#settings');
const mobileMore = $('#mobile-more');
const install = $('#install');
const local = initialState();
const rendered = new WeakMap();
const dialogReturn = new WeakMap();

const withTaskSync = (workspace) => workspace.sync ? workspace : { ...workspace, sync: newSyncState(workspace.tasks) };
let state = withTaskSync(local.state);
let canSave = state === local.state ? local.saved : saveState(state);
let today = localDate();
let view = readView();
let sort = 'smart';
let activeSpace = 'all';
let suggestionId = null;
let expanded = false;
let installPrompt;
let undoAction;
let toastTimeout;
let finishedSession;
let requestedViewFocus = false;
let reopenSearch = false;
let openedTaskId;
let focusTaskKey;
let queueSync;
let syncStatus = import.meta.env.PROD ? 'connecting' : 'local';
let captureAvailability;
let savingCaptureKey = false;
let latestVoiceChanges = [];
let voiceChoice;
let lastVoiceTask;
const voice = createVoiceControls(() => ({
  provider: captureAvailability?.providers?.[state.voiceProvider] === false ? 'device' : state.voiceProvider,
  intakeProvider: captureAvailability?.providers?.[state.intakeProvider] === false ? 'device' : state.intakeProvider,
  date: today,
}), finishVoice);

const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
$('#search-shortcut').textContent = shortcut;

function readView() {
  const hash = location.hash.slice(1);
  return Object.hasOwn(pages, hash) ? hash : 'today';
}

function getTask(id, tasks = state.tasks) {
  return tasks.find((task) => task.id === id);
}

function markUp(element, html) {
  if (rendered.get(element) === html) return;
  element.innerHTML = html;
  rendered.set(element, html);
}

function focusKey(element) {
  if (!element || element === document.body) return '';
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.matches('summary') && element.getAttribute('aria-label')) {
    return `summary[aria-label="${CSS.escape(element.getAttribute('aria-label'))}"]`;
  }
  if (element.dataset.action) {
    const attrs = Object.entries(element.dataset)
      .filter(([key]) => ['action', 'id', 'value'].includes(key))
      .map(([key, value]) => `[data-${key}="${CSS.escape(value)}"]`).join('');
    return `${element.localName}${attrs}`;
  }
  if (element.matches('a[href]')) return `a[href="${CSS.escape(element.getAttribute('href'))}"]`;
  return '';
}

function visibleElement(selector) {
  return selector ? $$(selector).find((element) => element.getClientRects().length > 0) : null;
}

function openDialog(dialog, content) {
  voice.cancel();
  const previous = $('dialog[open]');
  const trigger = previous ? dialogReturn.get(previous) : focusKey(document.activeElement);
  if (previous && previous !== dialog) previous.close();
  if (content !== undefined) dialog.innerHTML = content;
  dialogReturn.set(dialog, trigger);
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  $('dialog[open]')?.close();
}

function renderWorkspace({ restore = true } = {}) {
  const active = document.activeElement;
  const activeKey = focusKey(active);

  const nav = navigation(view, state.tasks);
  markUp($('#desktop-nav'), nav.desktop);
  markUp($('#mobile-nav'), nav.mobile);
  markUp($('#page-heading'), pageHeading(view, today));
  document.title = `${pages[view].label} · Dayline`;

  markUp(main, view === 'today'
    ? todayPage(state, { today, activeSpace, sort, suggestionId, expanded })
    : collectionPage(state, { view, today, sort }));

  paintVoiceResults();
  if (restore && active && !active.isConnected && !$('dialog[open]')) {
    const fallback = active.dataset.action === 'check' ? $('.task-check input', main) ?? $('#voice-main', main) : null;
    (visibleElement(activeKey) ?? fallback ?? $('#page-title'))?.focus({ preventScroll: true });
  }
  if (search.open) paintSearch();
  if (editor.open) paintTaskDetails();
  if (focus.open && state.session) paintFocusTask();
  paintTimer();
  voice.paint();
}

function commit(update, fromSync = false) {
  const latest = withTaskSync((canSave && readState()) || state);
  const next = update(latest);
  if (next === latest && fromSync) return;
  if (!fromSync) next.sync = trackTaskChanges(latest, next.tasks);
  if (next.session && !next.tasks.some((task) => task.id === next.session.taskId && !task.completedAt)) {
    next.session = null;
  }
  state = next;
  const saved = saveState(state);
  const lostStorage = canSave && !saved;
  canSave = saved;
  renderWorkspace();
  if (!fromSync && next.sync !== latest.sync) queueSync?.(0);
  if (lostStorage) notify('Device storage is full or unavailable. Export your tasks to keep a copy.', { persistent: true });
}

function updateTask(id, update) {
  let before;
  let after;
  commit((current) => ({
    ...current,
    tasks: current.tasks.map((task) => {
      if (task.id !== id) return task;
      before = task;
      after = { ...update(task), updatedAt: Math.max(Date.now(), task.updatedAt + 1) };
      return after;
    }),
  }));
  return { before, after };
}

function notify(message, { undo, persistent = false } = {}) {
  window.clearTimeout(toastTimeout);
  undoAction = undo;
  const container = $('dialog[open]') ?? document.body;
  if (toast.parentElement !== container) container.append(toast);
  const panel = document.createElement('div');
  panel.className = 'toast-panel';
  panel.innerHTML = `${icon('check-circle')} <span></span>`;
  $('span', panel).textContent = message;
  if (undo) {
    const button = document.createElement('button');
    button.className = 'text-button';
    button.dataset.action = 'undo';
    button.textContent = 'Undo';
    panel.append(button);
  }
  const close = document.createElement('button');
  close.className = 'icon-button';
  close.dataset.action = 'dismiss-toast';
  close.setAttribute('aria-label', 'Dismiss message');
  close.innerHTML = icon('x');
  panel.append(close);
  toast.replaceChildren(panel);
  if (!persistent) {
    toastTimeout = window.setTimeout(() => {
      if (!toast.contains(document.activeElement)) dismissToast();
    }, undo ? 12_000 : 5_500);
  }
}

function dismissToast() {
  undoAction = undefined;
  const hadFocus = toast.contains(document.activeElement);
  toast.replaceChildren();
  if (hadFocus) ($('dialog[open] [data-action="close"]') ?? $('#page-title')).focus({ preventScroll: true });
}

function clearSamples() {
  let removed = [];
  commit((current) => {
    removed = current.tasks.filter((task) => task.sample);
    return { ...current, tasks: current.tasks.filter((task) => !task.sample) };
  });
  if (!removed.length) return;
  if (settings.open) {
    settings.innerHTML = settingsContent(state, shortcut, syncMessages[syncStatus]);
    paintCaptureSettings();
    $('button[data-action="close"]', settings).focus();
  }
  notify('Example tasks cleared.', {
    undo: () => commit((current) => ({ ...current, tasks: mergeTasks(current.tasks, removed).tasks })),
  });
}

function paintCaptureSettings() {
  if (!settings.open) return;
  const providers = captureAvailability?.providers;
  for (const [id, current, choices] of [
    ['voice-provider', state.voiceProvider, voiceProviders],
    ['intake-provider', state.intakeProvider, intakeProviders],
  ]) {
    const select = document.getElementById(id);
    for (const option of select.options) {
      option.disabled = option.value !== 'device' && option.value !== current && !providers?.[option.value];
    }
    select.value = current;
    $(`#${id}-help`).textContent = current !== 'device' && !providers?.[current]
      ? 'Provider unavailable. Dayline can capture on this device.' : choices[current].description;
  }
  if (state.voiceProvider === state.intakeProvider && providers?.[state.voiceProvider]) {
    $('#voice-provider-help').textContent = `Uses ${voiceProviders[state.voiceProvider].label} to transcribe and interpret a recording in one request.`;
  }

  $('#capture-key-forms').hidden = !captureAvailability?.canSaveKeys;
  const availability = $('#capture-key-availability');
  const message = captureAvailability?.canSaveKeys
    ? 'Keys are encrypted and stored with your Dayline account. Usage follows your provider’s API billing.'
    : captureAvailability === undefined ? 'Checking key storage…' : 'Key setup is unavailable right now.';
  if (availability.textContent !== message) availability.textContent = message;
  for (const form of $$('[data-capture-key]', settings)) {
    const saved = captureAvailability?.personalKeys?.[form.dataset.captureKey];
    form.elements.key.placeholder = saved ? 'Paste a replacement key' : '';
    const remove = $('[data-action="remove-capture-key"]', form);
    remove.hidden = !saved;
    remove.disabled = savingCaptureKey;
    $('button[type="submit"]', form).disabled = savingCaptureKey;
  }
}

async function openSettings() {
  openDialog(settings, settingsContent(state, shortcut, syncMessages[syncStatus]));
  paintCaptureSettings();
  const select = $('#voice-provider', settings);
  const previous = captureAvailability;
  const available = await getCaptureAvailability();
  if (select === $('#voice-provider', settings) && previous === captureAvailability && !savingCaptureKey) {
    captureAvailability = available;
    paintCaptureSettings();
  }
}

async function saveCaptureKey(form, remove = false) {
  if (savingCaptureKey || !captureAvailability?.canSaveKeys) return;
  const provider = form.dataset.captureKey;
  const status = $('[data-key-status]', form);
  const value = remove ? null : form.elements.key.value.trim();
  form.reset();
  savingCaptureKey = true;
  status.textContent = remove ? 'Removing key…' : 'Saving key…';
  paintCaptureSettings();
  try {
    captureAvailability = await updateCaptureKey(provider, value);
    if (remove && (state.voiceProvider === provider || state.intakeProvider === provider)) {
      commit((current) => ({
        ...current,
        voiceProvider: current.voiceProvider === provider ? 'device' : current.voiceProvider,
        intakeProvider: current.intakeProvider === provider ? 'device' : current.intakeProvider,
      }));
    }
    status.textContent = remove ? 'Key removed.' : 'Key saved.';
  } catch {
    status.textContent = remove ? 'Couldn’t remove the key. Try again.' : 'Couldn’t save the key. Check it and try again.';
  } finally {
    savingCaptureKey = false;
    paintCaptureSettings();
  }
}

function paintTaskDetails() {
  const task = getTask(openedTaskId);
  $('#editor-heading', editor).textContent = task?.title ?? 'Task unavailable';
  $('#voice-task', editor).disabled = !task;
  markUp($('#task-details-body', editor), task ? taskDetailsContent(task, today) : '<p>This task is no longer available.</p>');
}

function openTask(id, listen = false) {
  const task = getTask(id);
  if (!task) return;
  reopenSearch = search.open;
  openedTaskId = id;
  openDialog(editor, taskVoiceContent(task, today));
  if (listen) voice.toggle('task', { taskId: id });
}

function speakInWorkspace() {
  $('#voice-main', main)?.scrollIntoView({ block: 'nearest' });
  voice.toggle('workspace', {
    plan: view === 'today' ? today : '',
    space: view === 'work' || view === 'personal' ? view : view === 'today' && activeSpace !== 'all' ? activeSpace : 'inbox',
  });
}

function paintVoiceResults() {
  const root = $('#voice-results', main);
  if (!root) return;
  const entries = latestVoiceChanges.flatMap(({ id, created }) => {
    const task = getTask(id);
    return task ? [{ task, created }] : [];
  });
  const choices = voiceChoice?.ids.map((id) => getTask(id)).filter(Boolean) ?? [];
  markUp(root, voiceResults(entries, choices, today));
}

function replaceSteps(titles, previous) {
  const unmatched = [...previous];
  return titles.map((text) => text.trim().slice(0, 140)).filter(Boolean).slice(0, 20).map((title) => {
    const match = unmatched.findIndex((step) => step.title === title);
    return match >= 0 ? unmatched.splice(match, 1)[0] : { id: newId(), title, done: false };
  });
}

function voiceTaskFields(task, fields) {
  const { minutes, complete, appendNote, steps, addSteps, ...changes } = fields;
  const next = { ...task, ...changes };
  if (minutes !== undefined) next.minutes = minutes || null;
  if (complete !== undefined) next.completedAt = complete ? task.completedAt ?? Date.now() : null;
  if (appendNote) next.notes = [next.notes, appendNote].filter(Boolean).join('\n').slice(0, 1_800);
  if (steps) next.steps = replaceSteps(steps, task.steps);
  if (addSteps) next.steps = [...next.steps, ...replaceSteps(addSteps, [])].slice(0, 20);
  return next;
}

function voiceTargets(tasks, name, taskId, recent) {
  const relative = isVoiceReference(name);
  if (taskId || relative) {
    const task = tasks.get(taskId || recent);
    if (!task || (!relative && !matchVoiceTasks([task], name).length)) return [];
    return [task];
  }
  return matchVoiceTasks([...tasks.values()], name);
}

function undoVoiceChanges(changes) {
  commit((current) => ({
    ...current,
    tasks: current.tasks.flatMap((task) => {
      const change = changes.get(task.id);
      if (!change || task.updatedAt !== change.after.updatedAt) return [task];
      return change.before ? [{ ...change.before, updatedAt: Math.max(Date.now(), task.updatedAt + 1) }] : [];
    }),
  }));
  latestVoiceChanges = [];
  voiceChoice = null;
  lastVoiceTask = null;
  paintVoiceResults();
}

function applyVoiceActions(commands, context) {
  const changes = new Map();
  let choice;
  let issue = '';
  let recent = lastVoiceTask;
  commit((current) => {
    const tasks = new Map(current.tasks.map((task) => [task.id, task]));
    for (const command of commands) {
      if (command.kind === 'unclear') {
        issue ||= context.taskId ? 'Say what to change, like “Move it to Friday.”' : 'Try saying a task to add or a change to a named task.';
        continue;
      }
      if (command.kind === 'create') {
        const { complete, ...fields } = command.fields;
        const task = voiceTaskFields(makeTask({ space: context.space ?? 'inbox', plan: context.plan ?? '' }), fields);
        tasks.set(task.id, task);
        changes.set(task.id, { before: null, after: task });
        recent = task.id;
        if (view === 'today' && isToday(task, today)) {
          if (!$('.focus-button', main) && changes.size === 1) suggestionId = task.id;
          if (activeSpace !== 'all' && activeSpace !== task.space) activeSpace = 'all';
        }
        continue;
      }
      const matches = voiceTargets(tasks, command.target, context.taskId, recent);
      if (matches.length !== 1) {
        if (matches.length > 1 && !choice) {
          choice = { command, ids: matches.map((task) => task.id), date: context.date };
        } else {
          issue ||= command.target && !isVoiceReference(command.target)
            ? 'I couldn’t identify one task named “' + command.target + '.” Tap its mic to try again.'
            : 'Say which task to update, or tap its mic.';
        }
        continue;
      }
      const task = matches[0];
      const next = voiceTaskFields(task, command.fields);
      recent = task.id;
      if (JSON.stringify(next) === JSON.stringify(task)) continue;
      const after = { ...next, sample: false, updatedAt: Math.max(Date.now(), task.updatedAt + 1) };
      const before = changes.has(task.id) ? changes.get(task.id).before : task;
      tasks.set(task.id, after);
      changes.set(task.id, { before, after });
    }
    return changes.size ? { ...current, tasks: [...tasks.values()] } : current;
  });
  latestVoiceChanges = [...changes].map(([id, { before }]) => ({ id, created: !before }));
  voiceChoice = choice;
  lastVoiceTask = changes.size > 1 ? null : recent;
  paintVoiceResults();
  if (changes.size) {
    const added = latestVoiceChanges.filter(({ created }) => created).length;
    const updated = changes.size - added;
    const count = (verb, value) => value ? verb + ' ' + value + (value === 1 ? ' task.' : ' tasks.') : '';
    notify([count('Added', added), count('Updated', updated)].filter(Boolean).join(' '), {
      undo: () => undoVoiceChanges(changes),
    });
  }
  return issue || (!changes.size && !choice ? 'No task changed.' : '');
}

function finishVoice(text, remote, context) {
  const local = parseVoiceTasks(text, context.date, Boolean(context.taskId));
  const localCount = local.filter(({ kind }) => kind !== 'unclear').length;
  const remoteCount = remote?.filter(({ kind }) => kind !== 'unclear').length ?? 0;
  const lostUpdate = local.some(({ kind }) => kind === 'update') && !remote?.some(({ kind }) => kind === 'update');
  return applyVoiceActions(remoteCount && remoteCount >= localCount && !lostUpdate ? remote : local, context);
}

function chooseVoiceTask(id) {
  const choice = voiceChoice;
  if (!choice?.ids.includes(id)) return;
  voice.cancel();
  const issue = applyVoiceActions([{ ...choice.command, target: '' }], { taskId: id, date: choice.date });
  if (issue) notify(issue);
  $('#voice-main', main)?.focus({ preventScroll: true });
}

function toggleTask(id, done) {
  const changedAt = done ? Date.now() : null;
  const { before, after } = updateTask(id, (task) => ({ ...task, completedAt: changedAt }));
  if (!after) return;
  notify(done ? 'Task completed.' : 'Task reopened.', {
    undo: () => updateTask(id, (task) => task.completedAt === changedAt ? { ...task, completedAt: before.completedAt } : task),
  });
}

function planTask(id, plan) {
  const { before, after } = updateTask(id, (task) => ({ ...task, plan }));
  if (!after) return;
  const stillDue = !plan && isToday(after, today);
  notify(plan ? 'Planned for today.' : stillDue ? 'Today’s plan removed. The due date still applies.' : 'Removed from today’s plan.', {
    undo: () => updateTask(id, (task) => task.plan === plan ? { ...task, plan: before.plan } : task),
  });
}

function deleteTask(id) {
  let removed;
  commit((current) => {
    removed = getTask(id, current.tasks);
    return { ...current, tasks: current.tasks.filter((task) => task.id !== id) };
  });
  if (!removed) return;
  notify('Task deleted.', {
    undo: () => commit((current) => ({
      ...current,
      tasks: getTask(id, current.tasks) ? current.tasks : [...current.tasks, removed],
    })),
  });
}

function pickAnother() {
  const candidates = state.tasks.filter((task) =>
    !task.completedAt && isToday(task, today) && (activeSpace === 'all' || activeSpace === task.space),
  );
  const ordered = orderTasks(candidates, { today, energy: state.energy });
  if (ordered.length < 2) return;
  const index = Math.max(0, ordered.findIndex((task) => task.id === suggestionId));
  suggestionId = ordered[(index + 1) % ordered.length].id;
  renderWorkspace();
  notify(`Suggested next: ${getTask(suggestionId).title}`);
}

function paintSearch() {
  markUp($('#search-results'), searchResults(state.tasks, $('#search-query').value));
}

function openSearch() {
  $('#search-query').value = '';
  paintSearch();
  openDialog(search);
  $('#search-query').focus();
}

function remaining(session, now = Date.now()) {
  if (!session) return 0;
  return session.endAt ? Math.max(0, session.endAt - now) : session.remaining;
}

function timeText(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function paintTimer() {
  const session = state.session;
  const timeLeft = remaining(session);
  const value = timeText(timeLeft);
  const running = Boolean(session?.endAt && timeLeft);
  $('.focus-shortcut').hidden = !session;
  $('.mobile-focus').hidden = !session;
  $('.focus-shortcut-time').textContent = timeLeft ? `Focus · ${value}` : 'Focus · Done';
  if (!focus.open) return;
  if (!session) {
    focus.close();
    return;
  }
  const clock = $('#focus-timer');
  if (clock && clock.textContent !== value) clock.textContent = value;
  const toggle = $('[data-action="timer-toggle"]', focus);
  if (toggle) markUp(toggle, running ? `${icon('pause')} Pause` : timeLeft ? `${icon('play')} Resume` : `${icon('arrow-clockwise')} Restart`);
}

function paintFocusTask() {
  const task = getTask(state.session.taskId);
  const key = JSON.stringify([task.title, task.space, task.notes, task.steps]);
  if (focusTaskKey === key) return;
  focusTaskKey = key;
  const target = focusKey(document.activeElement);
  focus.innerHTML = focusContent(task, state.session, timeText(remaining(state.session)));
  const previous = target && $(target, focus);
  previous?.focus?.({ preventScroll: true });
}

function openFocus(id) {
  const task = getTask(id);
  if (!task || task.completedAt) return;
  if (state.session?.taskId !== id) {
    const minutes = Math.min(task.minutes || state.focusMinutes, state.focusMinutes);
    const duration = minutes * 60_000;
    commit((current) => ({
      ...current, session: { taskId: id, duration, remaining: duration, endAt: Date.now() + duration },
    }));
  }
  if (!state.session) return;
  focusTaskKey = null;
  paintFocusTask();
  openDialog(focus);
  paintTimer();
}

function changeTimer(update) {
  commit((current) => current.session ? { ...current, session: update(current.session) } : current);
}

function toggleTimer() {
  changeTimer((session) => {
    const timeLeft = remaining(session);
    if (session.endAt && timeLeft) return { ...session, endAt: null, remaining: timeLeft };
    const resumeFrom = timeLeft || session.duration;
    return { ...session, endAt: Date.now() + resumeFrom, remaining: resumeFrom };
  });
}

function setDuration(duration) {
  changeTimer((session) => ({
    ...session,
    duration,
    remaining: duration,
    endAt: session.endAt && remaining(session) ? Date.now() + duration : null,
  }));
}

function tick() {
  const now = Date.now();
  const date = localDate(new Date(now));
  if (date !== today) {
    today = date;
    suggestionId = null;
    renderWorkspace();
  }
  const endAt = state.session?.endAt;
  if (endAt && endAt <= now && finishedSession !== endAt) {
    finishedSession = endAt;
    changeTimer((session) => session.endAt === endAt ? { ...session, endAt: null, remaining: 0 } : session);
    notify('Focus session finished.');
  }
  paintTimer();
}

async function showInstall() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = undefined;
    closeDialog();
    try {
      await prompt.prompt();
      return;
    } catch {
      // The custom instructions also work when the browser dismisses its prompt.
    }
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  openDialog(install, installContent(standalone));
}

function exportTasks() {
  const blob = new Blob([makeBackup(state.tasks)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dayline-${today}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  notify('Backup exported.');
}

async function importTasks(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error('This backup is too large to import.');
    const imported = parseBackup(await file.text());
    let changed = 0;
    commit((current) => {
      const result = mergeTasks(current.tasks, imported);
      changed = result.changed;
      return { ...current, tasks: result.tasks };
    });
    notify(changed ? `Imported ${changed} ${changed === 1 ? 'task' : 'tasks'}.` : 'Your tasks are already up to date.');
  } catch (error) {
    notify(error instanceof SyntaxError ? 'Choose a valid Dayline backup file.' : error.message);
  }
}

const actions = {
  'voice-main': speakInWorkspace,
  'voice-task': () => openedTaskId && voice.toggle('task', { taskId: openedTaskId }),
  'voice-edit': (button) => openTask(button.dataset.id, true),
  'voice-choose': (button) => chooseVoiceTask(button.dataset.id),
  'remove-capture-key': (button) => saveCaptureKey(button.form, true),
  edit: (button) => openTask(button.dataset.id),
  plan: (button) => planTask(button.dataset.id, today),
  unplan: (button) => planTask(button.dataset.id, ''),
  delete: (button) => deleteTask(button.dataset.id),
  filter: (button) => {
    activeSpace = button.dataset.value;
    suggestionId = null;
    renderWorkspace();
  },
  energy: (button) => {
    const energy = button.dataset.value;
    suggestionId = null;
    commit((current) => ({ ...current, energy }));
  },
  another: pickAnother,
  search: openSearch,
  more: () => openDialog(mobileMore, moreContent(view)),
  settings: openSettings,
  install: showInstall,
  close: closeDialog,
  focus: (button) => openFocus(button.dataset.id),
  'resume-focus': () => state.session && openFocus(state.session.taskId),
  'focus-complete': (button) => {
    closeDialog();
    toggleTask(button.dataset.id, true);
  },
  'timer-toggle': toggleTimer,
  'timer-reset': () => state.session && setDuration(state.session.duration),
  'show-examples': () => commit((current) => current.tasks.length ? current : { ...current, tasks: sampleTasks(today) }),
  'remove-examples': clearSamples,
  'dismiss-toast': dismissToast,
  'mobile-route': closeDialog,
  export: exportTasks,
  import: () => $('#backup-file').click(),
  undo: () => {
    const action = undoAction;
    dismissToast();
    action?.();
    notify('Change undone.');
  },
};

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('button[data-action], a[data-action]');
  const menu = event.target.closest('.task-menu');
  for (const item of $$('.task-menu[open]')) {
    if (item !== menu || trigger) item.open = false;
  }
  if (trigger) {
    const action = actions[trigger.dataset.action];
    if (menu) $('summary', menu).focus();
    action?.(trigger);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.hasAttribute('data-capture-key')) {
    event.preventDefault();
    saveCaptureKey(form);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'sort-by') {
    sort = target.value;
    renderWorkspace();
  } else if (target.id === 'voice-provider') {
    commit((current) => ({ ...current, voiceProvider: target.value }));
    paintCaptureSettings();
  } else if (target.id === 'intake-provider') {
    commit((current) => ({ ...current, intakeProvider: target.value }));
    paintCaptureSettings();
  } else if (target.id === 'default-length') {
    commit((current) => ({ ...current, focusMinutes: Number(target.value) }));
  } else if (target.id === 'timer-length') {
    setDuration(Number(target.value) * 60_000);
  } else if (target.dataset.action === 'check') {
    toggleTask(target.dataset.id, target.checked);
  } else if (target.dataset.action === 'step' && state.session) {
    const checked = target.checked;
    updateTask(state.session.taskId, (task) => ({
      ...task,
      steps: task.steps.map((step) => step.id === target.dataset.id ? { ...step, done: checked } : step),
    }));
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'search-query') paintSearch();
});

document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const open = $('dialog[open]');
  if (event.key === 'Escape') {
    if (open) {
      event.preventDefault();
      open.close();
      return;
    }
    if (voice.cancel()) event.preventDefault();
    const menu = $('.task-menu[open]');
    if (menu) {
      menu.open = false;
      $('summary', menu).focus();
    }
  }
  if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !open) {
    event.preventDefault();
    openSearch();
  } else if (event.key.toLowerCase() === 'n' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !open
    && !event.target.closest('input, select, textarea, [contenteditable]')) {
    event.preventDefault();
    speakInWorkspace();
  } else if (event.key === 'Enter' && event.target.id === 'search-query') {
    const result = $('.search-result');
    if (result) {
      event.preventDefault();
      openTask(result.dataset.id);
    }
  }
});

for (const dialog of $$('dialog')) {
  dialog.addEventListener('close', () => {
    if (dialog === editor && !editor.open) {
      voice.cancel('task');
      openedTaskId = null;
    }
    if (dialog === settings && !settings.open) {
      for (const form of $$('[data-capture-key]', settings)) form.reset();
    }
    if (dialog.contains(toast)) document.body.append(toast);
    if ($('dialog[open]')) return;
    if (dialog === editor && reopenSearch) {
      reopenSearch = false;
      paintSearch();
      const trigger = dialogReturn.get(dialog);
      dialogReturn.set(search, trigger);
      search.showModal();
      $('#search-query').focus();
      return;
    }
    const trigger = visibleElement(dialogReturn.get(dialog));
    if (trigger && !requestedViewFocus) trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      dialog.close();
    }
  });
}

main.addEventListener('toggle', (event) => {
  if (event.target.classList.contains('completed-today') && event.target.isConnected) expanded = event.target.open;
}, true);
$('#backup-file').addEventListener('change', importTasks);
$('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('#main-content').focus();
});
window.addEventListener('hashchange', () => {
  const next = readView();
  if (view === next) return;
  voice.cancel();
  view = next;
  activeSpace = 'all';
  suggestionId = null;
  reopenSearch = false;
  requestedViewFocus = true;
  closeDialog();
  renderWorkspace({ restore: false });
  window.scrollTo(0, 0);
  $('#page-title').focus({ preventScroll: true });
  requestAnimationFrame(() => { requestedViewFocus = false; });
});
window.addEventListener('storage', (event) => {
  if (!isWorkspaceChange(event) || !canSave) return;
  const incoming = readState();
  if (incoming) {
    const session = state.session;
    const previous = state.sync.pending[0]?.key;
    state = withTaskSync(incoming);
    renderWorkspace();
    if (focus.open && session?.taskId !== state.session?.taskId) focus.close();
    if (state.sync.pending.length && previous !== state.sync.pending[0].key) queueSync?.();
  }
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  notify('Dayline installed.');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
  else voice.cancel();
});

renderWorkspace();
if (import.meta.env.PROD) {
  queueSync = startTaskSync({
    read: () => state.sync,
    apply: (sent, result) => commit((current) => applyTaskSync(current, sent, result), true),
    status: (status) => {
      syncStatus = status;
      const message = $('#sync-status');
      if (message && message.textContent !== syncMessages[status]) message.textContent = syncMessages[status];
    },
  });
}
if (!canSave) notify('Device storage is unavailable. Export your tasks to keep a copy.', { persistent: true });
tick();
window.setInterval(tick, 1000);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', document.baseURI)).catch((error) => {
    console.warn('Dayline offline cache could not start.', error);
  });
}
