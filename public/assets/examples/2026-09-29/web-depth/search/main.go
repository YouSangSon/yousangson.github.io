// Synthetic, in-memory search model. Run with: go run main.go
package main

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type hit struct {
	source, id, owner, title string
	score                    int // Synthetic score; meaningful only in this example.
}
type source struct {
	name string
	rows []hit
	fail bool
}
type outcome struct {
	rows []hit
	err  error
}

func less(a, b hit) bool {
	if a.score != b.score {
		return a.score > b.score
	}
	if a.source != b.source {
		return a.source < b.source
	}
	return a.id < b.id
}

func querySource(ctx context.Context, s source, verifiedUser string, literal *regexp.Regexp, limit int) ([]hit, error) {
	if s.fail {
		return nil, fmt.Errorf("source unavailable")
	}
	var rows []hit
	for _, row := range s.rows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if row.owner == verifiedUser && literal.MatchString(row.title) {
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return less(rows[i], rows[j]) })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func search(ctx context.Context, sources []source, verifiedUser, text string, concurrency, perSource, pageSize int) ([]hit, []string, int64, error) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 64 || concurrency < 1 || perSource < pageSize || pageSize < 1 {
		return nil, nil, 0, fmt.Errorf("invalid search budget or query")
	}
	literal, err := regexp.Compile("(?i)" + regexp.QuoteMeta(text))
	if err != nil {
		return nil, nil, 0, err
	}
	sem := make(chan struct{}, concurrency)
	outcomes := make([]outcome, len(sources))
	var running, peak atomic.Int64
	var wg sync.WaitGroup
	for i, s := range sources {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				outcomes[i].err = ctx.Err()
				return
			}
			n := running.Add(1)
			for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
			}
			defer running.Add(-1)
			outcomes[i].rows, outcomes[i].err = querySource(ctx, s, verifiedUser, literal, perSource)
		}()
	}
	wg.Wait()
	var all []hit
	var failed []string
	for i, outcome := range outcomes {
		if outcome.err != nil {
			failed = append(failed, sources[i].name)
		} else {
			all = append(all, outcome.rows...)
		}
	}
	sort.Slice(all, func(i, j int) bool { return less(all[i], all[j]) })
	if len(all) > pageSize {
		all = all[:pageSize]
	}
	return all, failed, peak.Load(), nil
}

func main() {
	sources := []source{
		{"notes", []hit{
			{"notes", "private-1", "jun", "a.b private", 100},
			{"notes", "n1", "mina", "a.b notes", 10},
			{"notes", "n2", "mina", "axb notes", 20},
		}, false},
		{"tasks", []hit{
			{"tasks", "private-2", "jun", "a.b private", 90},
			{"tasks", "t1", "mina", "a.b task", 9},
		}, false},
		{"archive", nil, true},
	}
	raw := regexp.MustCompile("a.b")
	literal := regexp.MustCompile(regexp.QuoteMeta("a.b"))
	if !raw.MatchString("axb notes") || literal.MatchString("axb notes") {
		panic("literal matching check failed")
	}
	var globallyRanked []hit
	for _, s := range sources[:2] {
		for _, row := range s.rows {
			if literal.MatchString(row.title) {
				globallyRanked = append(globallyRanked, row)
			}
		}
	}
	sort.Slice(globallyRanked, func(i, j int) bool { return less(globallyRanked[i], globallyRanked[j]) })
	badPage := globallyRanked[:2] // Wrong: page before authorization.
	if badPage[0].owner == "mina" || badPage[1].owner == "mina" {
		panic("expected the naive page to hide authorized hits")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	got, failed, peak, err := search(ctx, sources, "mina", "a.b", 2, 2, 2)
	if err != nil || peak > 2 || len(got) != 2 || got[0].id != "n1" || got[1].id != "t1" || len(failed) != 1 || failed[0] != "archive" {
		panic("scoped search check failed")
	}
	fmt.Println("raw a.b matches axb:", raw.MatchString("axb notes"))
	fmt.Println("literal a.b matches axb:", literal.MatchString("axb notes"))
	fmt.Println("page before authorization: 0 visible hits")
	fmt.Println("authorized first page:", got[0].id, got[1].id)
	fmt.Println("failed source:", failed[0])
}
