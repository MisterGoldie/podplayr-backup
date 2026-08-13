export const PODPLAYR_OFFICIAL_FID = 1014485;

export const POD_MEMBER_FIDS = [
  15019, 7472, 14871, 414859, 235025, 892616, 323867, 892130,
];

export const ACYL_FIDS = [
  7472, 14871, 414859, 356115, 296462, 195864, 1020224, 1020659,
];

export function isPodMember(fid: number) {
  return POD_MEMBER_FIDS.includes(fid);
}

export function isAcylMember(fid: number) {
  return ACYL_FIDS.includes(fid);
}

export function isOfficialAccount(fid: number) {
  return fid === PODPLAYR_OFFICIAL_FID;
}
