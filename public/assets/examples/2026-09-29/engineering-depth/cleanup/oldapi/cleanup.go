package oldapi

import "example.com/engineering-depth/cleanup/draft"

// Remove retains the old entry point; draft.Store owns the decision and change.
func Remove(store *draft.Store, id string) bool { return store.Remove(id) }
