import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecallBotManager } from '../src/recall/RecallBotManager.js';

// Minimal fake db: returns the canned rows for the reseed SELECT.
function fakeDb(rows) {
  return {
    calls: [],
    async query(text, params) {
      this.calls.push({ text, params });
      if (/FROM bot_usage/.test(text) && /SELECT/.test(text)) {
        return { rows };
      }
      return { rows: [] };
    },
  };
}

function manager(db) {
  const m = new RecallBotManager({
    apiKey: 'k',
    publicWebhookUrl: 'https://example.com',
  });
  m.db = db;
  return m;
}

test('reseedFromDatabase repopulates routing maps from open rows', async () => {
  const joined = new Date('2026-07-04T00:00:00Z');
  const db = fakeDb([
    {
      recall_bot_id: 'bot-1',
      meeting_id: 'm-1',
      org_id: 'org-a',
      joined_at: joined,
      room_name: 'Zoom 1',
      room_color: '#00ff00',
      bot_name: 'Q&A Bot',
    },
  ]);
  const m = manager(db);

  const seeded = await m.reseedFromDatabase();

  assert.equal(seeded, 1);
  assert.equal(m.meetingsByBot.get('bot-1'), 'm-1');
  const info = m.botsByMeeting.get('m-1');
  assert.equal(info.botId, 'bot-1');
  assert.equal(info.orgId, 'org-a');
  assert.equal(info.roomName, 'Zoom 1');
  assert.equal(info.roomColor, '#00ff00');
  assert.equal(info.botName, 'Q&A Bot');
});

test('reseedFromDatabase falls back to defaults for legacy rows without display fields', async () => {
  const db = fakeDb([
    {
      recall_bot_id: 'bot-2',
      meeting_id: 'm-2',
      org_id: 'org-b',
      joined_at: new Date(),
      room_name: null,
      room_color: null,
      bot_name: null,
    },
  ]);
  const m = manager(db);

  await m.reseedFromDatabase();

  const info = m.botsByMeeting.get('m-2');
  assert.equal(info.roomName, 'Meeting m-2');
  assert.equal(info.roomColor, '#ef4444');
  assert.equal(info.botName, 'Chat Bot');
});

test('reseedFromDatabase never clobbers live in-memory state', async () => {
  const db = fakeDb([
    {
      recall_bot_id: 'bot-stale',
      meeting_id: 'm-3',
      org_id: 'org-a',
      joined_at: new Date(),
      room_name: 'Stale',
      room_color: '#000000',
      bot_name: 'Old',
    },
  ]);
  const m = manager(db);
  m.botsByMeeting.set('m-3', { botId: 'bot-live', meetingId: 'm-3', orgId: 'org-a' });
  m.meetingsByBot.set('bot-live', 'm-3');

  const seeded = await m.reseedFromDatabase();

  assert.equal(seeded, 0);
  assert.equal(m.botsByMeeting.get('m-3').botId, 'bot-live');
  assert.equal(m.meetingsByBot.has('bot-stale'), false);
});

test('reseedFromDatabase is a safe no-op without a db or on query failure', async () => {
  const noDb = manager(null);
  noDb.db = null;
  assert.equal(await noDb.reseedFromDatabase(), 0);

  const failing = manager({
    async query() {
      throw new Error('connection refused');
    },
  });
  assert.equal(await failing.reseedFromDatabase(), 0);
  assert.equal(failing.botsByMeeting.size, 0);
});
