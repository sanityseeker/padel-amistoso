const seenKey = (registrationId: string) => `answer-changes-seen:${registrationId}`;

export function hasUnseenAnswerChanges(
  registrationId: string,
  latestId: number | null | undefined,
) {
  if (!latestId) return false;
  try {
    const seenId = Number(localStorage.getItem(seenKey(registrationId)) || 0);
    return latestId > (Number.isFinite(seenId) ? seenId : 0);
  } catch {
    return true;
  }
}

export function markAnswerChangesSeen(registrationId: string, latestId: number | undefined) {
  if (!latestId) return;
  try {
    const key = seenKey(registrationId);
    const seenId = Number(localStorage.getItem(key) || 0);
    if (latestId > (Number.isFinite(seenId) ? seenId : 0))
      localStorage.setItem(key, String(latestId));
  } catch {
    // Keep the notification visible when browser storage is unavailable.
  }
}
