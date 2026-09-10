/*
  Supabase runs its sign-in server and its database API on different clocks,
  and when the database's runs behind, a token minted a moment ago is refused
  with PostgREST's PGRST303 "JWT issued at future". A token a few seconds old
  passes. So a refusal for that one reason is worth a short wait and another
  go, and if it keeps happening the message should say what it is rather than
  parrot the code.
*/
export interface ApiError {
  code?: string
  message: string
}

export interface ApiResult<T> {
  data: T
  error: ApiError | null
}

/** The pauses before each retry, in milliseconds; two retries in total. */
export const SKEW_RETRY_DELAYS = [1500, 3000]

export function isClockSkew(error: ApiError | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST303' || /issued at future/i.test(error.message)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs a request; if the database refused the token as issued in the future,
 * waits and runs it again, at most twice. Anything else is returned as is.
 */
export async function retryOnClockSkew<T>(run: () => PromiseLike<ApiResult<T>>): Promise<ApiResult<T>> {
  let result = await run()
  for (const delay of SKEW_RETRY_DELAYS) {
    if (!isClockSkew(result.error)) break
    await sleep(delay)
    result = await run()
  }
  return result
}

/** The text shown for a failed call; the clock-skew case gets a plain explanation. */
export function skewMessage(error: ApiError): string {
  if (!isClockSkew(error)) return error.message
  return `the sign-in server's clock is ahead of the database's (${error.message}); wait a minute and try again`
}

/**
 * The text shown for a failed database call. Two refusals get plain words:
 * the clock skew above, and a column the schema does not have yet, which
 * means a migration under supabase/migrations has not been applied.
 */
export function explainError(error: ApiError): string {
  if (error.code === 'PGRST204' || /schema cache/i.test(error.message)) {
    return `the database has not been updated for this yet (apply the latest migration under supabase/migrations); ${error.message}`
  }
  return skewMessage(error)
}
