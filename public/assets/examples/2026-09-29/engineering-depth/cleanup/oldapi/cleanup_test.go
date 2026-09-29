package oldapi

import (
	"reflect"
	"testing"

	"example.com/engineering-depth/cleanup/draft"
)

func checkPath(t *testing.T, remove func(*draft.Store, string) bool) {
	t.Helper()
	store := draft.New([]string{"old", "live", "keep"}, []string{"live"})
	if !remove(store, "old") || remove(store, "live") {
		t.Fatal("wrong removal decision")
	}
	if got, want := store.IDs(), []string{"keep", "live"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("retained IDs = %v; want %v", got, want)
	}
}

func TestLegacyEntryPoint(t *testing.T) { checkPath(t, Remove) }

func TestDirectEntryPoint(t *testing.T) { checkPath(t, (*draft.Store).Remove) }
