'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'notes', 'app.jsx');

function readAppSource() {
  return fs.readFileSync(appPath, 'utf8');
}

test('任务列表按钮在已处于 task list 时继续拆分 task item，而不是再次 toggle 整个列表', () => {
  const appJsx = readAppSource();

  assert.match(appJsx, /function toggleOrAppendTaskList/);
  assert.match(appJsx, /editor\.isActive\('taskList'\)/);
  assert.match(appJsx, /chain\.splitListItem\('taskItem'\)\.run\(\)/);
  assert.match(appJsx, /chain\.toggleTaskList\(\)\.run\(\)/);
  assert.match(appJsx, /function canToggleOrAppendTaskList/);
  assert.match(appJsx, /editor\.can\(\)\.chain\(\)\.focus\(\)\.splitListItem\('taskItem'\)\.run\(\)/);
});
