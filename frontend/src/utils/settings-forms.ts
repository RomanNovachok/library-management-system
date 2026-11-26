export const settingNameLimit = 100;

export const normalizeSettingName = (value: string) => value.trim().replace(/\s+/gu, ' ');

export function parseSettingPercent(value: string): string | undefined {
  const dotPercent = value.trim().replace(',', '.');
  if (!/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/.test(dotPercent)) return undefined;
  const [whole = '', fraction = ''] = dotPercent.split('.');
  return `${whole.replace(/^0(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}

export const hasEditableDamageRate = (code: string) => code === 'MINOR' || code === 'MAJOR';

export function damageRuleExplanation(code: string) {
  switch (code) {
    case 'NONE': return 'Без нових пошкоджень штраф завжди становить 0%.';
    case 'MINOR': return 'Ставка за нові незначні пошкодження.';
    case 'MAJOR': return 'Ставка за нові серйозні пошкодження.';
    case 'LOST': return 'При втраті примірника компенсація завжди дорівнює всій заставі.';
    default: return 'Ставку правила зафіксовано.';
  }
}
