import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_AVATAR_COLORS,
  getAccountAvatarInitials,
  getAccountInitials,
  getRandomAccountAvatarColor,
} from '../src/components/drawerAvatar.ts';

test('account initials use the first and last name and tolerate missing or single names', () => {
  assert.equal(getAccountInitials(' Medson   van Kasese '), 'MK');
  assert.equal(getAccountInitials('Madonna'), 'MA');
  assert.equal(getAccountInitials('M'), 'M');
  assert.equal(getAccountInitials('   '), null);
  assert.equal(getAccountInitials(null), null);
});

test('signed-in avatar initials fall back to an email name or generic initials', () => {
  assert.equal(getAccountAvatarInitials('Medson Kasese', 'other@example.com'), 'MK');
  assert.equal(getAccountAvatarInitials(null, 'medson.kasese@example.com'), 'MK');
  assert.equal(getAccountAvatarInitials('  ', 'medson_kasese@example.com'), 'MK');
  assert.equal(getAccountAvatarInitials(null, null), 'US');
});

test('avatar color selection always returns a palette color and bounds unusual random values', () => {
  assert.equal(getRandomAccountAvatarColor(() => 0), ACCOUNT_AVATAR_COLORS[0]);
  assert.equal(getRandomAccountAvatarColor(() => 0.5), ACCOUNT_AVATAR_COLORS[3]);
  assert.equal(getRandomAccountAvatarColor(() => 1), ACCOUNT_AVATAR_COLORS.at(-1));
  assert.equal(getRandomAccountAvatarColor(() => -1), ACCOUNT_AVATAR_COLORS[0]);
  assert.equal(getRandomAccountAvatarColor(() => Number.NaN), ACCOUNT_AVATAR_COLORS[0]);
  assert.ok(ACCOUNT_AVATAR_COLORS.length >= 4);
});
