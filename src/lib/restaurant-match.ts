import type { Restaurant } from '@/lib/types';
export function restaurantNameKey(name:string) {return name.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');}
export function similarRestaurants(name:string,restaurants:Restaurant[],exclude?:string) {
  const key=restaurantNameKey(name);
  return key.length<2?[]:restaurants.filter(r=>r.id!==exclude&&(()=>{const other=restaurantNameKey(r.name);return other===key||(Math.min(key.length,other.length)>=3&&(other.includes(key)||key.includes(other)));})());
}
