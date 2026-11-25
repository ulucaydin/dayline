import { newId } from './tasks.js';

export const syncBatchSize = 24;
export const syncPageSize = 64;
const taskFields = ['title', 'space', 'due', 'plan', 'priority', 'minutes', 'notes', 'steps', 'completedAt'];

function mutation(id, base, before, after, undoOf = null) {
  return { id, key: newId(), base, before, after, undoOf };
}

export function newSyncState(tasks) {
  return {
    owner: null,
    cursor: 0,
    versions: [],
    pending: tasks.filter((task) => !task.sample).map((task) => mutation(task.id, 0, null, task)),
  };
}

export function trackTaskChanges(current, nextTasks) {
  if (current.tasks === nextTasks) return current.sync;
  const previous = new Map(current.tasks.filter((task) => !task.sample).map((task) => [task.id, task]));
  const next = new Map(nextTasks.filter((task) => !task.sample).map((task) => [task.id, task]));
  const versions = new Map(current.sync.versions);
  const pending = new Map(current.sync.pending.map((change) => [change.id, change]));
  let changed = false;

  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(id) ?? null;
    const after = next.get(id) ?? null;
    if (before === after) continue;
    const queued = pending.get(id);
    const undoOf = after && queued
      ? (queued.after ? queued.undoOf : queued.key)
      : null;
    pending.set(id, mutation(id, queued?.base ?? versions.get(id) ?? 0, queued ? queued.before : before, after, undoOf));
    changed = true;
  }
  return changed ? { ...current.sync, pending: [...pending.values()] } : current.sync;
}

export function syncRequest(sync) {
  const mutations = sync.owner ? sync.pending.slice(0, syncBatchSize) : [];
  return {
    mutations,
    body: {
      owner: sync.owner,
      cursor: sync.cursor,
      changes: mutations.map(({ id, key, base, after }) => ({ id, key, base, task: after })),
    },
  };
}

function equal(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function mergeCheckedSteps(base, local, remote) {
  const original = new Map(base.map((step) => [step.id, step]));
  const edits = new Map(local.map((step) => [step.id, step]));
  return remote.map((step) => {
    const before = original.get(step.id);
    const after = edits.get(step.id);
    if (before && after && before.done !== after.done && step.done === before.done) {
      return { ...step, done: after.done };
    }
    return step;
  });
}

function rebaseTask(base, local, remote, allowRestore, ownChange) {
  if (!local) return null;
  if (!remote) return allowRestore ? local : null;
  // An older app could already have transferred this task by backup.
  if (!base) return local.updatedAt > remote.updatedAt ? local : remote;

  const merged = { ...remote };
  for (const field of taskFields) {
    if (equal(local[field], base[field])) continue;
    if (ownChange || equal(remote[field], base[field])) merged[field] = local[field];
    else if (field === 'steps') merged.steps = mergeCheckedSteps(base.steps, local.steps, remote.steps);
  }
  if (equal(merged, remote)) return remote;
  merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt + 1);
  return merged;
}

export function applyTaskSync(current, sent, response) {
  const sync = current.sync;
  if (sync.owner && sync.owner !== response.owner) return current;
  const cursor = Math.max(sync.cursor, response.cursor);
  const versions = new Map(sync.versions);
  const pending = new Map(sync.pending.map((change) => [change.id, change]));
  const inFlight = new Map(sent.map((change) => [change.id, change]));
  const tasks = new Map(current.tasks.map((task) => [task.id, task]));
  let changed = sync.owner !== response.owner || cursor !== sync.cursor;

  const latestRecords = new Map();
  for (const record of [...response.records, ...response.written]) {
    if (record.revision > (latestRecords.get(record.id)?.revision ?? 0)) latestRecords.set(record.id, record);
  }

  for (const { id, revision, key, task } of latestRecords.values()) {
    if (revision <= (versions.get(id) ?? 0)) continue;
    versions.set(id, revision);
    changed = true;
    const dirty = pending.get(id);
    let visible = task;
    if (dirty && dirty.key !== key) {
      const flight = inFlight.get(id);
      const ownChange = flight?.key === key;
      const base = ownChange ? flight.after : dirty.before;
      visible = rebaseTask(base, dirty.after, task, dirty.undoOf === key, ownChange);
    }
    if (equal(visible, task)) pending.delete(id);
    else pending.set(id, mutation(id, revision, task, visible));

    if (visible) tasks.set(id, visible);
    else tasks.delete(id);
  }

  return changed ? {
    ...current,
    tasks: [...tasks.values()],
    sync: { owner: response.owner, cursor, versions: [...versions], pending: [...pending.values()] },
  } : current;
}
