'use strict';

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function lastSevenDateKeys(date = new Date()) {
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(end);
    next.setDate(end.getDate() - 6 + index);
    return localDateKey(next);
  });
}

module.exports = { lastSevenDateKeys, localDateKey };
