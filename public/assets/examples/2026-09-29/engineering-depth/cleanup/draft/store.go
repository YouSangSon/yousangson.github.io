package draft

import "sort"

// Store is an in-memory example. Real persistence needs its own concurrency contract.
type Store struct {
	drafts map[string]bool
	active map[string]bool
}

func New(ids, active []string) *Store {
	s := &Store{drafts: make(map[string]bool), active: make(map[string]bool)}
	for _, id := range ids {
		s.drafts[id] = true
	}
	for _, id := range active {
		s.active[id] = true
	}
	return s
}

// Remove owns both the protected-state decision and the in-memory change.
func (s *Store) Remove(id string) bool {
	if !s.drafts[id] || s.active[id] {
		return false
	}
	delete(s.drafts, id)
	return true
}

func (s *Store) IDs() []string {
	ids := make([]string, 0, len(s.drafts))
	for id := range s.drafts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
