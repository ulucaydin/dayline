import { normalizeTask } from '../src/tasks.js';
import { syncBatchSize, syncPageSize } from '../src/task-sync-state.js';

const bodyLimit = 512_000;
const responseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const taskColumns = 'task_id, revision, change_key, task_json';

const saveTask = `
  INSERT INTO dayline_tasks (owner_id, task_id, revision, change_key, task_json)
  SELECT ?, ?, (SELECT COALESCE(MAX(revision), 0) + 1 FROM dayline_tasks WHERE owner_id = ?), ?, ?
  WHERE ? = COALESCE((SELECT revision FROM dayline_tasks WHERE owner_id = ? AND task_id = ?), 0)
  ON CONFLICT (owner_id, task_id) DO UPDATE SET
    revision = excluded.revision,
    change_key = excluded.change_key,
    task_json = excluded.task_json
`;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: responseHeaders });
}

async function readPayload(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > bodyLimit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  }
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;
}

function normalizeChanges(changes) {
  const seen = new Set();
  const parsed = [];
  for (const change of changes) {
    if (!identifier(change?.id) || !identifier(change.key) || !counter(change.base) || seen.has(change.id)) return null;
    const task = change.task === null ? null : normalizeTask(change.task);
    if (change.task !== null && (!task || task.id !== change.id || task.sample)) return null;
    seen.add(change.id);
    parsed.push({ id: change.id, key: change.key, base: change.base, task });
  }
  return parsed;
}

function record(row) {
  return {
    id: row.task_id,
    revision: row.revision,
    key: row.change_key,
    task: row.task_json === null ? null : JSON.parse(row.task_json),
  };
}

export async function handleTaskSync(request, env) {
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) return json({ error: 'Sign-in required.' }, 401);
  if (request.method !== 'POST') {
    return Response.json({ error: 'Use POST.' }, { status: 405, headers: { ...responseHeaders, Allow: 'POST' } });
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Use this Dayline origin.' }, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Send a JSON request.' }, 415);
  }

  const data = await readPayload(request);
  if (!counter(data?.cursor) || !Array.isArray(data.changes) || data.changes.length > syncBatchSize) {
    return json({ error: 'That sync request is invalid.' }, 400);
  }
  if (data.owner !== owner && (data.owner !== null || data.cursor !== 0 || data.changes.length)) {
    return json({ error: 'The signed-in account has changed.' }, 409);
  }
  const changes = normalizeChanges(data.changes);
  if (!changes) return json({ error: 'That task update is invalid.' }, 400);

  try {
    const database = env.DB;
    const writes = changes.map(({ id, key, base, task }) => database.prepare(saveTask)
      .bind(owner, id, owner, key, task ? JSON.stringify(task) : null, base, owner, id));
    const updates = database.prepare(`
      SELECT ${taskColumns} FROM dayline_tasks
      WHERE owner_id = ? AND revision > ? ORDER BY revision LIMIT ?
    `).bind(owner, data.cursor, syncPageSize + 1);
    const statements = [...writes, updates];
    if (changes.length) {
      statements.push(database.prepare(`
        SELECT ${taskColumns} FROM dayline_tasks
        WHERE owner_id = ? AND task_id IN (${changes.map(() => '?').join(',')})
      `).bind(owner, ...changes.map(({ id }) => id)));
    }
    const results = await database.batch(statements);
    const records = results[writes.length].results.slice(0, syncPageSize).map(record);
    return json({
      owner,
      records,
      written: changes.length ? results.at(-1).results.map(record) : [],
      cursor: records.at(-1)?.revision ?? data.cursor,
      more: results[writes.length].results.length > syncPageSize,
    });
  } catch (error) {
    console.error('Dayline task sync failed', error instanceof Error ? error.message : 'Database unavailable');
    return json({ error: 'Task sync is temporarily unavailable.' }, 503);
  }
}
