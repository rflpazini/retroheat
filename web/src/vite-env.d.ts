/// <reference types="vite/client" />

// Both values are public by design: the anon key is meant to ship in the
// bundle, and row-level security in the database is the real boundary. When
// either is missing the account features are hidden and the site behaves
// exactly as it did before they existed.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
