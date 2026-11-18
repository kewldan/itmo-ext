export const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'max',
  nameOverride: '',
  groupOverride: '',
};

export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
