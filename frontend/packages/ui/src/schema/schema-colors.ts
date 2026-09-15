// The kind palette shared by the schema reading view and the schema editor, so a type looks the
// same whether it is being read or edited: struct blue, list green, text amber, and so on.

export const kindColor: Record<string, string> = {
  map: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  struct: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  list: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  string: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  integer: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  float: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  boolean: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  link: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  bytes: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  null: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  union: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  var: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  instance: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  any: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

/** A reference to a named schema (not a core kind): the reading view's link chip. */
export const refChipColor = 'border-primary/30 text-primary bg-transparent'
