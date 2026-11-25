import { intakeProviders, voiceProviders } from './voice-providers.js';

export const spaces = {
  inbox: { label: 'Inbox', icon: 'tray' },
  work: { label: 'Work', icon: 'briefcase' },
  personal: { label: 'Personal', icon: 'house' },
};

const priorities = { high: 32, normal: 10, low: 0 };
const day = 86_400_000;
const storageKey = 'dayline.workspace.v1';
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

export function daysFrom(date, offset) {
  const shifted = new Date(`${date}T12:00:00`);
  shifted.setDate(shifted.getDate() + offset);
  return localDate(shifted);
}

export function dateDistance(from, to) {
  return (Date.parse(to) - Date.parse(from)) / day;
}

export function dateText(date, today) {
  if (!date) return '';
  if (date === today) return 'Today';
  if (date === daysFrom(today, 1)) return 'Tomorrow';
  if (date === daysFrom(today, -1)) return 'Yesterday';
  const asDate = new Date(`${date}T12:00:00`);
  return date.slice(0, 4) === today.slice(0, 4)
    ? dateFormat.format(asDate)
    : asDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function makeTask(fields) {
  const now = Date.now();
  return {
    id: newId(),
    title: '',
    space: 'inbox',
    due: '',
    plan: '',
    priority: 'normal',
    minutes: null,
    notes: '',
    steps: [],
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    sample: false,
    ...fields,
  };
}

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const quantities = ['a', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const weekday = String.raw`(?:next\s+|this\s+)?(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const month = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const monthDay = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const monthDate = String.raw`(?:${month}\s+${monthDay}|${monthDay}\s+${month})(?:,?\s+\d{4})?`;
const relativeDate = String.raw`in\s+(?:\d{1,3}|${quantities.join('|')})\s+(?:days?|weeks?)`;
const datePhrase = String.raw`day after tomorrow|tomorrow|today|tonight|${relativeDate}|${weekday}|\d{4}-\d{2}-\d{2}|${monthDate}`;
const deadlineCue = String.raw`by|before|on|for|no later than|(?:(?:it['’]s|it is|this is)\s+)?due(?:\s+(?:by|on))?|(?:the\s+)?deadline(?:\s+is)?`;
const priorityPhrase = String.raw`not\s+(?:important|urgent)|no\s+rush|low\s+priority|normal\s+priority|(?:high|top)\s+priority|important|urgent|asap`;
const captureTail = (phrase) => new RegExp(String.raw`(?:\s*[,;.!?—]\s+|\s*[,;]\s*|\s+)(?:${phrase})\s*[.!?]*$`, 'i');
const shorthandTail = captureTail(String.raw`(#work|#personal|#inbox|!high|!low|!normal|\d{1,3}m)`);
const priorityTail = captureTail(String.raw`(?:and\s+)?(?:(?:it['’]s|it is|this (?:task |item )?is|mark (?:it|this) as)\s+(?:(?:an?|the)\s+)?(?:(?:very|really)\s+)?(${priorityPhrase})(?:\s+(?:item|task|one))?|priority(?:\s*:\s*|\s+)(high|normal|low)|(${priorityPhrase}))`);
const dateTail = captureTail(String.raw`(?:(${deadlineCue})(?:\s*:\s*|\s+))?(${datePhrase})`);
const spaceTail = captureTail(String.raw`(?:(?:it['’]s|it is|this is)\s+)?(?:for|in|under)\s+(?:my\s+)?(work|personal|inbox)(?:\s+(?:space|list))?`);
const capturePrefix = new RegExp(String.raw`^(?:(work|personal|inbox)\s*:|(${priorityPhrase})\s*:|(?:(by|before|due|on|no later than)\s+)?(${datePhrase})\s*[,;:])\s*`, 'i');

function captureDate(phrase, today) {
  const words = phrase.toLowerCase().replace(/[.,]/g, '').split(/\s+/);
  const date = words.join(' ');
  if (date === 'today' || date === 'tonight') return today;
  if (date === 'tomorrow') return daysFrom(today, 1);
  if (date === 'day after tomorrow') return daysFrom(today, 2);
  if (words[0] === 'in') {
    const count = /^\d/.test(words[1]) ? Number(words[1]) : words[1] === 'a' ? 1 : quantities.indexOf(words[1]);
    return daysFrom(today, count * (words[2].startsWith('week') ? 7 : 1));
  }
  if (date.includes('-')) return dateValue(date);

  const targetDay = weekdays.indexOf(words.at(-1).slice(0, 3));
  if (targetDay >= 0) {
    const dayOfWeek = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
    const offset = targetDay - dayOfWeek;
    return daysFrom(today, words[0] === 'next' ? offset + 7 : (offset + 7) % 7);
  }

  const [monthName, dayNumber] = /^\d/.test(words[0]) ? [words[1], words[0]] : words;
  const monthNumber = months.indexOf(monthName.slice(0, 3)) + 1;
  const calendarDate = (year) => dateValue(`${year}-${String(monthNumber).padStart(2, '0')}-${String(parseInt(dayNumber, 10)).padStart(2, '0')}`);
  if (words[2]) return calendarDate(words[2]);
  const year = Number(today.slice(0, 4));
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = calendarDate(year + offset);
    if (candidate >= today) return candidate;
  }
  return '';
}

function captureDeadline(phrase, cue, today) {
  const due = captureDate(phrase, today);
  return due && cue?.toLowerCase() === 'before' ? daysFrom(due, -1) : due;
}

function capturePriority(phrase) {
  const label = phrase.toLowerCase().replace(/\s+/g, ' ');
  if (/^(low|not |no rush)/.test(label)) return 'low';
  return label.startsWith('normal') ? 'normal' : 'high';
}

function captureSuffix(title, today) {
  const shorthand = title.match(shorthandTail);
  if (shorthand) {
    const token = shorthand[1].toLowerCase();
    if (token[0] === '#') return [shorthand.index, 'space', token.slice(1)];
    if (token[0] === '!') return [shorthand.index, 'priority', token.slice(1)];
    const minutes = parseInt(token, 10);
    return minutes >= 1 && minutes <= 480 ? [shorthand.index, 'minutes', minutes] : null;
  }
  const priority = title.match(priorityTail);
  if (priority && !/\b(?:why|whether|is|are|anything|something)\s*$/i.test(title.slice(0, priority.index))) {
    return [priority.index, 'priority', capturePriority(priority[1] ?? priority[2] ?? priority[3])];
  }

  const space = title.match(spaceTail);
  if (space && /\S\s+\S/.test(title.slice(0, space.index).trim())) {
    return [space.index, 'space', space[1].toLowerCase()];
  }

  const date = title.match(dateTail);
  if (date && !date[1] && /\b(?:from|since|through|until|after|dated)\s*$/i.test(title.slice(0, date.index))) return null;
  const due = date && captureDeadline(date[2], date[1], today);
  return due ? [date.index, 'due', due] : null;
}

export function parseCapture(text, today) {
  const fields = {};
  const original = text.trim();
  let title = original;
  while (title) {
    const suffix = captureSuffix(title, today);
    if (!suffix || suffix[0] === 0) break;
    const [index, field, value] = suffix;
    fields[field] ??= value;
    title = title.slice(0, index).trimEnd();
  }

  let prefix;
  while ((prefix = title.match(capturePrefix)) && prefix[0].length < title.length) {
    const due = prefix[4] && captureDeadline(prefix[4], prefix[3], today);
    if (prefix[4] && !due) break;
    if (prefix[1]) fields.space ??= prefix[1].toLowerCase();
    else if (prefix[2]) fields.priority ??= capturePriority(prefix[2]);
    else fields.due ??= due;
    title = title.slice(prefix[0].length);
  }

  // Correct the supplied example without rewriting other tasks about a card.
  if (/^fix the card by next tuesday[.!?]\s+it['’]s an important item[.!?]?$/i.test(original)) title = title.slice(0, -1);
  return { ...fields, title: title.slice(0, 140) };
}

export function isToday(task, today) {
  return Boolean((task.due && task.due <= today) || (task.plan && task.plan <= today));
}

export function nextDate(task) {
  const { due, plan } = task;
  if (due && plan) return due < plan ? due : plan;
  return due || plan;
}

function smartScore(task, today, energy) {
  const days = task.due ? dateDistance(today, task.due) : Infinity;
  let urgency = 0;
  if (days < 0) urgency = 150 + Math.min(14, -days);
  else if (days === 0) urgency = 95;
  else if (days === 1) urgency = 30;
  else if (days <= 3) urgency = 14;

  const planned = task.plan && task.plan <= today ? 8 : 0;
  const quick = task.minutes && task.minutes <= 15 ? 6 : 0;
  let energyFit = 0;
  if (energy === 'light' && task.minutes) {
    if (task.minutes <= 10) energyFit = 38;
    else if (task.minutes <= 20) energyFit = 12;
    else energyFit = -16;
  }
  return urgency + priorities[task.priority] + planned + quick + energyFit;
}

export function orderTasks(tasks, { today, energy = 'any', sort = 'smart' }) {
  const bySmart = (a, b) => smartScore(b, today, energy) - smartScore(a, today, energy);
  const sorters = {
    smart: bySmart,
    date: (a, b) => (a.due || a.plan || '9999').localeCompare(b.due || b.plan || '9999'),
    quick: (a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity),
    newest: (a, b) => b.createdAt - a.createdAt,
  };
  const compare = sorters[sort] ?? bySmart;
  return [...tasks].sort((a, b) => compare(a, b) || bySmart(a, b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function recommendationReasons(task, today, energy) {
  const reasons = [];
  if (task.due && task.due < today) reasons.push('Overdue');
  else if (task.due === today) reasons.push('Due today');
  else if (task.due === daysFrom(today, 1)) reasons.push('Due tomorrow');
  else if (task.plan && task.plan <= today) reasons.push('On your plan');
  if (task.priority === 'high') reasons.push('High priority');
  if (energy === 'light' && task.minutes && task.minutes <= 10) reasons.push('Light task');
  return reasons.length ? reasons.slice(0, 2) : ['Ready to start'];
}

export function sampleTasks(today) {
  const tomorrow = daysFrom(today, 1);
  const withSample = (fields) => makeTask({ ...fields, sample: true });
  return [
    withSample({
      title: 'Send the project recap', space: 'work', due: today, priority: 'high', minutes: 15,
      steps: [
        { id: newId(), title: 'Open the project notes', done: false },
        { id: newId(), title: 'Pull out three key updates', done: false },
        { id: newId(), title: 'Send the recap to the team', done: false },
      ],
    }),
    withSample({ title: 'Book a dentist appointment', space: 'personal', due: today, minutes: 5 }),
    withSample({ title: 'Review the planning notes', space: 'work', due: tomorrow, plan: today, priority: 'high', minutes: 30 }),
    withSample({ title: 'Pick up groceries', space: 'personal', plan: today, minutes: 20 }),
    withSample({ title: 'Water the plants', space: 'personal', plan: today, minutes: 5, completedAt: Date.now() }),
    withSample({ title: 'Reply to the team thread', space: 'work', plan: today, minutes: 10, completedAt: Date.now() }),
    withSample({ title: 'Save weekend trip ideas' }),
    withSample({ title: 'Look into reminder settings' }),
    withSample({ title: 'Pay the electricity bill', space: 'personal', due: tomorrow, minutes: 5 }),
    withSample({ title: 'Prep the meeting agenda', space: 'work', due: daysFrom(today, 3), minutes: 20 }),
  ];
}

function textValue(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function timeValue(value) {
  return Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000_000 ? value : null;
}

export function normalizeTask(raw) {
  const id = textValue(raw?.id, 100);
  const title = textValue(raw?.title, 140);
  if (!id || !title) return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.slice(0, 20).flatMap((step) => {
      const stepTitle = textValue(step?.title, 140);
      return stepTitle ? [{ id: textValue(step.id, 100) || newId(), title: stepTitle, done: step.done === true }] : [];
    })
    : [];
  const updatedAt = timeValue(raw.updatedAt) ?? Date.now();
  return {
    id,
    title,
    space: Object.hasOwn(spaces, raw.space) ? raw.space : 'inbox',
    due: dateValue(raw.due),
    plan: dateValue(raw.plan),
    priority: Object.hasOwn(priorities, raw.priority) ? raw.priority : 'normal',
    minutes: Number.isInteger(raw.minutes) && raw.minutes > 0 && raw.minutes <= 480 ? raw.minutes : null,
    notes: textValue(raw.notes, 1800),
    steps,
    completedAt: timeValue(raw.completedAt),
    createdAt: timeValue(raw.createdAt) ?? updatedAt,
    updatedAt,
    sample: raw.sample === true,
  };
}

function normalizeSession(session, tasks) {
  if (!session || !tasks.some((task) => task.id === session.taskId && !task.completedAt)) return null;
  const { taskId, duration, remaining } = session;
  if (!Number.isFinite(duration) || duration < 1_000 || duration > 3_600_000) return null;
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > duration) return null;
  return { taskId, duration, remaining, endAt: timeValue(session.endAt) };
}

export function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.tasks)) return null;
    const tasks = raw.tasks.map(normalizeTask).filter((task) => task && (
      raw.examplesOptional || !task.sample || task.updatedAt > task.createdAt
    ));
    const sync = raw.sync;
    return {
      version: 1,
      tasks,
      examplesOptional: true,
      energy: raw.energy === 'light' ? 'light' : 'any',
      focusMinutes: [5, 10, 15, 25].includes(raw.focusMinutes) ? raw.focusMinutes : 15,
      voiceProvider: Object.hasOwn(voiceProviders, raw.voiceProvider) ? raw.voiceProvider : 'device',
      intakeProvider: Object.hasOwn(intakeProviders, raw.intakeProvider) ? raw.intakeProvider : 'device',
      session: normalizeSession(raw.session, tasks),
      sync: Number.isSafeInteger(sync?.cursor) && Array.isArray(sync.versions) && Array.isArray(sync.pending) ? sync : null,
    };
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function initialState() {
  const saved = readState();
  if (saved) return { state: saved, saved: true };
  const state = {
    version: 1,
    tasks: [],
    examplesOptional: true,
    energy: 'any',
    focusMinutes: 15,
    voiceProvider: 'device',
    intakeProvider: 'device',
    session: null,
    sync: null,
  };
  return { state, saved: saveState(state) };
}

export function isWorkspaceChange(event) {
  return event.key === storageKey;
}

export function makeBackup(tasks) {
  return JSON.stringify({ format: 'dayline', version: 1, tasks }, null, 2);
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data?.format !== 'dayline' || data.version !== 1 || !Array.isArray(data.tasks)) {
    throw new Error('Choose a Dayline backup file.');
  }
  const tasks = data.tasks.map(normalizeTask);
  if (tasks.includes(null)) throw new Error('Some tasks in this backup are unreadable.');
  return tasks;
}

export function mergeTasks(current, incoming) {
  const merged = new Map(current.map((task) => [task.id, task]));
  let changed = 0;
  for (const task of incoming) {
    const existing = merged.get(task.id);
    if (existing && existing.updatedAt >= task.updatedAt) continue;
    merged.set(task.id, task);
    changed += 1;
  }
  return { tasks: [...merged.values()], changed };
}
