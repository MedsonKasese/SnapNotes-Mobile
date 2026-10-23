import assert from 'node:assert/strict';
import test from 'node:test';
import { getNoteActionsMenuLayout } from '../src/noteActionsMenu.ts';

test('prefers above the trigger when the full menu fits', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 200, y: 400, width: 100, height: 40 },
      { x: 0, y: 0, width: 400, height: 800 },
      120,
    ),
    { left: 84, top: 272, width: 216, maxHeight: 776 },
  );
});

test('places below when there is not room above and the menu fits below', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 200, y: 40, width: 40, height: 30 },
      { x: 0, y: 0, width: 400, height: 800 },
      120,
    ),
    { left: 24, top: 78, width: 216, maxHeight: 776 },
  );
});

test('clamps the popup to the left viewport inset', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 0, y: 40, width: 20, height: 30 },
      { x: 0, y: 0, width: 400, height: 800 },
      100,
    ),
    { left: 12, top: 78, width: 216, maxHeight: 776 },
  );
});

test('clamps the popup to the right viewport inset', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 380, y: 40, width: 40, height: 30 },
      { x: 0, y: 0, width: 400, height: 800 },
      100,
    ),
    { left: 172, top: 78, width: 216, maxHeight: 776 },
  );
});

test('normalizes window-measured coordinates against an offset viewport', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 210, y: 350, width: 50, height: 40 },
      { x: 10, y: 50, width: 400, height: 800 },
      100,
    ),
    { left: 34, top: 192, width: 216, maxHeight: 776 },
  );
});

test('caps width and height in a short landscape viewport and clamps the popup', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 270, y: 100, width: 40, height: 30 },
      { x: 0, y: 0, width: 320, height: 240 },
      400,
    ),
    { left: 92, top: 12, width: 216, maxHeight: 216 },
  );
});

test('keeps a large-font menu above when its full measured height fits', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 200, y: 760, width: 60, height: 30 },
      { x: 0, y: 0, width: 400, height: 800 },
      700,
    ),
    { left: 44, top: 52, width: 216, maxHeight: 776 },
  );
});

test('uses the side with more available room and clamps when neither fits', () => {
  assert.deepEqual(
    getNoteActionsMenuLayout(
      { x: 200, y: 250, width: 40, height: 40 },
      { x: 0, y: 0, width: 400, height: 500 },
      250,
    ),
    { left: 24, top: 12, width: 216, maxHeight: 476 },
  );
});

test('returns finite zero-sized layout for a tiny viewport and initial zero height', () => {
  const layout = getNoteActionsMenuLayout(
    { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 30, height: 20 },
    { x: 0, y: 0, width: 10, height: 8 },
    0,
  );
  assert.deepEqual(layout, { left: 5, top: 4, width: 0, maxHeight: 0 });
  assert.ok(Object.values(layout).every(Number.isFinite));
});

test('sanitizes invalid and negative geometry without producing NaN', () => {
  const layout = getNoteActionsMenuLayout(
    { x: Number.POSITIVE_INFINITY, y: Number.NaN, width: -20, height: -1 },
    { x: Number.NaN, y: Number.NEGATIVE_INFINITY, width: -100, height: -50 },
    Number.POSITIVE_INFINITY,
  );
  assert.deepEqual(layout, { left: 0, top: 0, width: 0, maxHeight: 0 });
  assert.ok(Object.values(layout).every(Number.isFinite));
});
