import { dateValue, parseCapture } from './tasks.js';

export const maxVoiceActions = 8;
export const shortVoiceText = 1_200;
export const maxVoiceText = 8_000;

const taskVerbs = 'add(?!\\s+(?:(?:a|the)\\s+)?(?:notes?|steps?)\\b)|book|buy|call|check|create|draft|email|finish|fix|get|order|pay|pick|prepare|read|remind|review|schedule|send|submit|write';
const ownAction = /^(?:(?:add|create)\s+(?:a\s+)?(?:new\s+)?task(?:\s+(?:to|called|named|for))?|(?:also\s+)?remind\s+me\s+to|I\s+(?:need|want)\s+to)\b[\s,:-]*/i;
const nextTask = new RegExp(String.raw`\s+(?:and then|then)\s+|[;\n]+|(?:[.!?]\s+|,\s*|\s+and\s+)(?=(?:${taskVerbs}|rename|reschedule|postpone|reopen|move|mark|delete)\s+)`, 'i');
const nextChange = /(?:,\s*|\s+(?:and then|and|then)\s+)(?=(?:add|append|change|clear|due|give|make|mark|move|plan|put|remove|rename|set|take)\s+)/i;
const priorityNames = { high: 'high', urgent: 'high', important: 'high', normal: 'normal', medium: 'normal', low: 'low', 'no rush': 'low' };
const estimateWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function clean(text) {
  return text.trim().replace(/^["“‘]+|["”’!?.,]+$/gu, '').trim();
}

function priorityValue(text) {
  const value = clean(text).toLowerCase().replace(/\s+priority$/, '');
  return Object.hasOwn(priorityNames, value) ? priorityNames[value] : '';
}

function spaceValue(text) {
  const value = clean(text).toLowerCase().replace(/^(?:my|the)\s+/, '').replace(/\s+(?:space|list)$/, '');
  return ['work', 'personal', 'inbox'].includes(value) ? value : '';
}

function dateFromSpeech(text, today) {
  const parsed = parseCapture(`Task due ${clean(text)}`, today);
  if (parsed.title === 'Task') return parsed.due;
}

function estimateFromSpeech(text) {
  const match = clean(text).match(/^(\d+|[a-z]+(?:[ -][a-z]+)?)\s+(minutes?|hours?)$/i);
  if (!match) return;
  const [first, second] = match[1].toLowerCase().split(/[ -]/);
  const ones = estimateWords.indexOf(first);
  const ten = tens.indexOf(first);
  const trailer = second && estimateWords.indexOf(second);
  const quantity = /^\d+$/.test(first) ? Number(first)
    : first === 'a' || first === 'an' ? 1
      : !second && ones >= 0 ? ones
        : ten >= 0 && (!second || (trailer > 0 && trailer < 10)) ? (ten + 2) * 10 + (trailer || 0) : 0;
  const minutes = quantity * (/^hour/i.test(match[2]) ? 60 : 1);
  if (minutes > 0 && minutes <= 480) return minutes;
}

function fieldEntry(target, key, value) {
  return value === undefined ? null : { target: clean(target), fields: { [key]: value } };
}

function textSteps(text) {
  return text.split(/[,;\n]+|\s+(?:and then|then)\s+/i).map(clean).filter(Boolean).slice(0, 20);
}

function readChange(raw, today, selected) {
  const text = clean(raw).replace(/^(?:please|actually|can you|could you)\s+/i, '');
  let match;
  if ((match = text.match(/^mark\s+(?:(.+?)\s+)?(?:as\s+)?(?:done|complete|completed|finished)$/i))) {
    return fieldEntry(match[1] ?? '', 'complete', true);
  }
  if ((match = text.match(/^reopen(?:\s+(.+))?$/i))) return fieldEntry(match[1] ?? '', 'complete', false);
  if ((match = text.match(/^complete\s+(it|this|that|the last one)$/i))) return fieldEntry(match[1], 'complete', true);
  if (selected && /^(?:complete(?: it| this| the task)?|done|done with it|finished)$/i.test(text)) return fieldEntry('', 'complete', true);
  if ((match = text.match(/^rename\s+(.+?)\s+to\s+(.+)$/i))) return fieldEntry(match[1], 'title', clean(match[2]));
  if (selected && (match = text.match(/^rename\s+to\s+(.+)$/i))) return fieldEntry('', 'title', clean(match[1]));
  if ((match = text.match(/^(?:set|change)\s+(?:(?:the|its)\s+)?(due date|deadline|priority|space|title|name|estimate|duration)(?:\s+(?:of|for|on)\s+(.+?))?\s+to\s+(.+)$/i))) {
    const [field, target, value] = match.slice(1);
    const name = field.toLowerCase();
    if (name === 'due date' || name === 'deadline') return fieldEntry(target ?? '', 'due', dateFromSpeech(value, today));
    if (name === 'priority') return fieldEntry(target ?? '', 'priority', priorityValue(value) || undefined);
    if (name === 'space') return fieldEntry(target ?? '', 'space', spaceValue(value) || undefined);
    if (name === 'estimate' || name === 'duration') return fieldEntry(target ?? '', 'minutes', estimateFromSpeech(value));
    return fieldEntry(target ?? '', 'title', clean(value));
  }
  if ((match = text.match(/^(move|put|change|update|reschedule|postpone|plan|schedule)\s+(.+?)\s+(to|for|in|under|until|on)\s+(.+)$/i))) {
    const [verb, target, connector, value] = match.slice(1);
    const update = /^update$/i.test(verb) && /^to$/i.test(connector);
    const space = spaceValue(value);
    if (space && (update || /^(move|put|change)$/i.test(verb))) return fieldEntry(target, 'space', space);
    const date = dateFromSpeech(value, today);
    if (date && update) return fieldEntry(target, 'due', date);
    if (date && (selected || isVoiceReference(target)) && /^(plan|schedule)$/i.test(verb)) return fieldEntry(target, 'plan', date);
    if (date && /^(move|change|reschedule|postpone)$/i.test(verb)) return { target: clean(target), fields: { due: date, plan: date } };
    if (selected && isVoiceReference(target) && /^change$/i.test(verb) && /^to$/i.test(connector)) return fieldEntry(target, 'title', clean(value));
  }
  if ((match = text.match(/^make\s+(.+?)\s+(?:a\s+)?(high(?: priority)?|low(?: priority)?|normal(?: priority)?|urgent|important|no rush)$/i))) {
    return fieldEntry(match[1], 'priority', priorityValue(match[2]));
  }
  if ((match = text.match(/^(?:clear|remove)\s+(?:the\s+)?(?:due date|deadline)(?:\s+(?:of|for|from)\s+(.+))?$/i))) {
    return fieldEntry(match[1] ?? '', 'due', '');
  }
  if (!selected) return null;

  if (/^(?:unplan(?: it)?|take (?:it|this) off (?:today(?:’s|'s)?(?: plan)?|the plan))$/i.test(text)) return fieldEntry('', 'plan', '');
  if (/^(?:clear|remove)\s+(?:the\s+)?notes?$/i.test(text)) return fieldEntry('', 'notes', '');
  if (/^(?:clear|remove)\s+(?:the\s+)?(?:estimate|duration)$/i.test(text)) return fieldEntry('', 'minutes', 0);
  if ((match = text.match(/^(?:add|append)\s+(?:a\s+)?note(?:\s+that|\s+saying)?[\s:]+(.+)$/i))) {
    return fieldEntry('', 'appendNote', clean(match[1]));
  }
  if ((match = text.match(/^(?:add|set)\s+(?:a\s+|the\s+)?steps?(?:\s+to)?[\s:]+(.+)$/i))) {
    return fieldEntry('', /^add/i.test(text) ? 'addSteps' : 'steps', textSteps(match[1]));
  }
  if ((match = text.match(/^(?:change|set)\s+(?:the\s+)?notes?\s+to\s+(.+)$/i))) return fieldEntry('', 'notes', clean(match[1]));
  if ((match = text.match(/^give\s+(?:it|this)\s+(.+)$/i))) return fieldEntry('', 'minutes', estimateFromSpeech(match[1]));
  const fields = parseCapture(`Task ${text}`, today);
  if (fields.title === 'Task') {
    delete fields.title;
    return { target: '', fields };
  }
  const value = priorityValue(text);
  if (value) return fieldEntry('', 'priority', value);
  const space = spaceValue(text);
  if (space) return fieldEntry('', 'space', space);
  return null;
}

function readUpdate(text, today, selected) {
  const [first, ...more] = text.split(nextChange);
  const change = readChange(first, today, selected);
  const target = !change && more.length && first.match(/^(?:edit|update)\s+(?:the\s+)?(?:task\s+)?(.+)$/i)?.[1];
  const action = change ?? (target ? { target: clean(target), fields: {} } : null);
  if (!action) return null;
  for (const clause of more) {
    const extra = readChange(clause, today, true);
    if (!extra || (extra.target && !isVoiceReference(extra.target) && voiceName(extra.target) !== voiceName(action.target))) {
      return { kind: 'unclear', target: action.target };
    }
    Object.assign(action.fields, extra.fields);
  }
  return { kind: 'update', ...action };
}

function readCreation(text, today) {
  const [title, ...clauses] = text.split(nextChange);
  const changes = clauses.map((clause) => readChange(clause, today, true));
  const belongsToNewTask = changes.length && changes.every((change) => change && isVoiceReference(change.target));
  const fields = parseCapture(belongsToNewTask ? title : text, today);
  if (belongsToNewTask) Object.assign(fields, ...changes.map((change) => change.fields));
  fields.title = fields.title.replace(/^\p{Ll}(?=\p{Ll})/u, (letter) => letter.toUpperCase());
  return fields;
}

export function parseVoiceTasks(text, today, selected) {
  const parts = (selected ? [text] : text.split(nextTask)).map(clean).filter(Boolean);
  if (parts.length > maxVoiceActions) return [{ kind: 'unclear', target: '' }];
  return parts.map((part) => {
    const requested = part.replace(/^(?:please|can you|could you)\s+/i, '');
    const explicitCreate = ownAction.test(requested);
    const deleteRequest = /^(?:delete|trash)\b/i.test(requested);
    if ((selected && explicitCreate) || (!explicitCreate && deleteRequest)) return { kind: 'unclear', target: '' };
    if (!explicitCreate) {
      const update = readUpdate(requested, today, selected);
      if (update) return update;
      if (selected || /^(?:mark|rename|reopen|reschedule|postpone|set (?:the )?(?:due|deadline|priority)|move (?:it|this|that) to|(?:edit|update) (?:the )?task)\b/i.test(requested)) {
        return { kind: 'unclear', target: '' };
      }
    }
    const fields = readCreation(requested.replace(ownAction, ''), today);
    return fields.title ? { kind: 'create', target: '', fields } : { kind: 'unclear', target: '' };
  });
}

function voiceName(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\b(?:the|a|an|called|named|task)\b/g, ' ').trim().replace(/\s+/g, ' ');
}

export function isVoiceReference(text) {
  return /^(?:it|this|that|last(?: one)?|previous(?: one)?)?$/.test(voiceName(text));
}

export function matchVoiceTasks(tasks, reference) {
  const name = voiceName(reference);
  if (name.length < 2) return [];
  const names = tasks.map((task) => [task, voiceName(task.title)]);
  const exact = names.filter(([, title]) => title === name);
  if (exact.length) return exact.map(([task]) => task);
  const words = name.split(' ');
  return names.filter(([, title]) => words.every((word) => title.split(' ').includes(word))).map(([task]) => task);
}

export function normalizeVoiceActions(raw, selected) {
  if (!Array.isArray(raw) || raw.length > maxVoiceActions) return null;
  const actions = [];
  for (const action of raw) {
    if (!action || typeof action !== 'object') return null;
    const { kind, target, ...input } = action;
    if (!['create', 'update', 'unclear'].includes(kind) || (selected && kind === 'create')) return null;
    const fields = {};
    for (const [name, limit] of [['title', 140], ['notes', 1800], ['appendNote', 1800]]) {
      if (typeof input[name] === 'string') fields[name] = input[name].trim().slice(0, limit);
    }
    for (const name of ['due', 'plan']) {
      if (input[name] === '' || dateValue(input[name])) fields[name] = input[name];
    }
    if (['work', 'personal', 'inbox'].includes(input.space)) fields.space = input.space;
    if (['high', 'normal', 'low'].includes(input.priority)) fields.priority = input.priority;
    if (Number.isInteger(input.minutes) && input.minutes >= 0 && input.minutes <= 480) fields.minutes = input.minutes;
    if (typeof input.complete === 'boolean') fields.complete = input.complete;
    for (const name of ['steps', 'addSteps']) {
      if (Array.isArray(input[name])) fields[name] = input[name].filter((step) => typeof step === 'string')
        .map((step) => step.trim().slice(0, 140)).filter(Boolean).slice(0, 20);
    }
    if (fields.title === '') delete fields.title;
    if ((kind === 'create' && !fields.title) || (kind === 'update' && !Object.keys(fields).length)) return null;
    actions.push({ kind, target: typeof target === 'string' ? target.trim().slice(0, 140) : '', fields });
  }
  return actions;
}
