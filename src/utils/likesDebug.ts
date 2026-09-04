/** Always-on likes/Firebase diagnostics. Filter the console by `[LikesDebug]`. */
function summarizeError(error: unknown) {
  if (!error || typeof error !== 'object') return { error: String(error) };
  const err = error as { code?: string; message?: string; stack?: string };
  return {
    code: err.code,
    message: err.message,
    error,
  };
}

export const likesDebug = {
  log(step: string, data?: unknown) {
    if (data === undefined) {
      console.log(`[LikesDebug] ${step}`);
      return;
    }
    console.log(`[LikesDebug] ${step}`, data);
  },
  error(step: string, error: unknown, data?: unknown) {
    console.error(`[LikesDebug] ${step}`, data ?? '', summarizeError(error));
  },
};
