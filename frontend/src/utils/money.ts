export function formatHryvnia(value: string): string {
  if (!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(value)) throw new Error('Invalid decimal money string');
  const [integer, fraction] = value.split('.');
  // Group decimal digits directly: no conversion to floating point or rounding.
  return `${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')},${fraction}\u00a0грн`;
}
