export const MAX_MENU_IMAGES = 6;
export const MAX_MENU_BYTES = 5 * 1024 * 1024;
export const MENU_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const menuImageUrl = (id: string) => `/api/menu-images?id=${encodeURIComponent(id)}`;
export class MenuError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function restaurantWebsite(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new MenuError('官网链接最长 2048 个字符。');
  const text = value.trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new MenuError('请填写以 https:// 或 http:// 开头的官网链接。'); }
}
export function menuIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_MENU_IMAGES || value.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) || new Set(value).size !== value.length)
    throw new MenuError(`每家餐馆最多保存 ${MAX_MENU_IMAGES} 张不同的菜单图片，请重新选择。`);
  return value;
}
export function restaurantWithMedia<T extends {menu_images?: unknown}>(row: T): Omit<T,'menu_images'> & {menu_images:string[]} {
  return {...row, menu_images: JSON.parse(typeof row.menu_images === 'string' ? row.menu_images : '[]') as string[]};
}
