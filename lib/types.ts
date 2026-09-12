export type Restaurant = { id: string; name: string; cuisine: string; address: string; source: string; selected: number; position: number; count?: number };
export type Vote = { nickname: string; candidate_id: string; created_at: string };
export type FoodOrder = { id: string; nickname: string; dish: string; quantity: number; note: string; status: 'pending' | 'claimed' | 'delivered'; claimant_name: string | null; isMine: boolean; canManage: boolean; created_at: string };
export type Room = { id: string; title: string; status: string; winner_id: string | null; created_at: string; revision: number; isHost: boolean; candidates: Restaurant[]; votes: Vote[]; myVote: Vote | null; total: number; orders: FoodOrder[] };
export type Catalog = { restaurants: Restaurant[]; rooms: { id: string; title: string; status: string }[] };
