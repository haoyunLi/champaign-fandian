const mealDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatMealDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  const parts = mealDate.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part('year')}年${part('month')}月${part('day')}日 ${part('hour')}:${part('minute')}`;
}
