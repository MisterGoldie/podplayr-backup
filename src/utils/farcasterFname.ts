export function normalizeFname(name?: string | null): string {
  return (name || '').trim().replace(/^@+/, '').toLowerCase();
}

/** Strip @, extra spaces — what the search bar and Neynar should actually query. */
export function normalizeSearchQuery(raw: string): string {
  return (raw || '').trim().replace(/^@+/, '').replace(/\s+/g, ' ');
}

export function pickExactFnameUser<T extends { username?: string | null }>(
  users: T[],
  query: string
): T | undefined {
  const q = normalizeFname(query);
  if (!q) return undefined;
  return users.find((user) => normalizeFname(user.username) === q);
}

type RankableUser = {
  username?: string | null;
  display_name?: string | null;
  follower_count?: number | null;
};

function searchRank(user: RankableUser, query: string): number {
  const q = normalizeFname(query);
  if (!q) return 9;
  const username = normalizeFname(user.username);
  const display = (user.display_name || '').trim().toLowerCase();
  if (username === q) return 0;
  if (username.startsWith(q)) return 1;
  if (display === q) return 2;
  if (display.startsWith(q)) return 3;
  if (username.includes(q)) return 4;
  if (display.includes(q)) return 5;
  return 6;
}

/** Exact fname first, then prefix matches — Neynar often ranks clones like jessepollak0 first. */
export function rankByExactFname<T extends RankableUser>(users: T[], query: string): T[] {
  return rankSearchUsers(users, query);
}

export function rankSearchUsers<T extends RankableUser>(users: T[], query: string): T[] {
  return [...users].sort((a, b) => {
    const rank = searchRank(a, query) - searchRank(b, query);
    if (rank !== 0) return rank;
    return (b.follower_count || 0) - (a.follower_count || 0);
  });
}


export function isNumericFnameClone(username: string, otherUsernames: Iterable<string>): boolean {
  const name = normalizeFname(username);
  const match = name.match(/^(.*[a-z_])(\d+)$/i);
  if (!match) return false;
  const stem = match[1];
  const others = new Set([...otherUsernames].map(normalizeFname));
  return others.has(stem);
}

const POPULAR_BLOCKED_USERNAMES = new Set(['jessepollak0']);
const POPULAR_BLOCKED_FIDS = new Set([389279]);

export function filterPopularFnameClones<T extends { fid?: number; username?: string | null }>(
  users: T[]
): T[] {
  const names = users.map((user) => normalizeFname(user.username));
  return users.filter((user) => {
    const username = normalizeFname(user.username);
    if (!username) return false;
    if (POPULAR_BLOCKED_USERNAMES.has(username) || POPULAR_BLOCKED_FIDS.has(Number(user.fid))) {
      return false;
    }
    return !isNumericFnameClone(username, names);
  });
}
