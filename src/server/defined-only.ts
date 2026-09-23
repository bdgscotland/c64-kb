/** Optional fields with no value, dropped so the result fits a `field?: T` type under exactOptionalPropertyTypes. */
export type DefinedOnly<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Copy `o` without its undefined-valued keys. JSON drops those keys anyway,
 * so what reaches a store, a log line or a client is unchanged.
 */
export function definedOnly<T extends Record<string, unknown>>(o: T): DefinedOnly<T> {
  // Object.fromEntries loses the key types; the filter is what makes every kept value defined.
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as DefinedOnly<T>;
}
