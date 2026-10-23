package lookahead

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
)

type item struct {
	Key  string
	Size int64
	ETag string
}
type page struct {
	Items   []item
	HasMore bool
	Marker  string
}

// readPage uses a last-returned-key cursor for a stable, recursive listing.
func readPage(ctx context.Context, client *minio.Client, n, maxKeys int, after string) (page, error) {
	if n < 1 || n > 1000 || maxKeys < 1 || maxKeys > 1000 {
		return page{}, errors.New("page size out of range")
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	objects := client.ListObjects(child, "teaching-bucket", minio.ListObjectsOptions{
		Recursive: true, MaxKeys: maxKeys, StartAfter: after,
	})
	result := page{}
	var listErr error
	for object := range objects {
		if object.Err != nil {
			listErr = object.Err
			break
		}
		if len(result.Items) == n {
			result.HasMore = true
			break
		}
		result.Items = append(result.Items, item{object.Key, object.Size, object.ETag})
		result.Marker = object.Key
	}
	cancel()
	// The SDK requires draining even after cancellation, until its producer exits.
	for range objects {
	}
	if err := ctx.Err(); err != nil {
		return page{}, err
	}
	if listErr != nil {
		return page{}, listErr
	}
	return result, nil
}

func requestSize(n int, lookahead bool) int {
	if lookahead && n < 1000 {
		return n + 1
	}
	return n
}

type listResult struct {
	XMLName               xml.Name `xml:"ListBucketResult"`
	Name                  string
	MaxKeys               int
	KeyCount              int
	IsTruncated           bool
	NextContinuationToken string `xml:",omitempty"`
	Contents              []item
}

func newClient(t *testing.T, endpoint string) *minio.Client {
	t.Helper()
	transport := &http.Transport{}
	t.Cleanup(transport.CloseIdleConnections)
	client, err := minio.New(strings.TrimPrefix(endpoint, "http://"), &minio.Options{
		Secure: false, Region: "us-east-1", BucketLookup: minio.BucketLookupPath, Transport: transport,
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func runListing(t *testing.T, total, n int, optimized bool, after string) (page, []string) {
	t.Helper()
	var mu sync.Mutex
	var trace []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		maxKeys, err := strconv.Atoi(q.Get("max-keys"))
		if err != nil || maxKeys < 1 || maxKeys > 1000 || q.Get("list-type") != "2" || q.Get("delimiter") != "" || r.URL.Path != "/teaching-bucket/" {
			t.Errorf("unexpected listing request: %s", r.URL)
			http.Error(w, "bad request", 400)
			return
		}
		start := 0
		for start < total && fmt.Sprintf("object-%04d", start+1) <= q.Get("start-after") {
			start++
		}
		token := q.Get("continuation-token")
		if token != "" {
			// Opaque fixture tokens deliberately differ from object keys.
			start, err = strconv.Atoi(strings.TrimPrefix(token, "fixture-token-"))
			if err != nil || token != fmt.Sprintf("fixture-token-%d", start) || start < 0 || start > total {
				t.Errorf("invalid token: %q", token)
				http.Error(w, "bad token", 400)
				return
			}
		}
		mu.Lock()
		trace = append(trace, fmt.Sprintf("max=%d token=%q after=%q", maxKeys, token, q.Get("start-after")))
		mu.Unlock()
		end := min(start+maxKeys, total)
		result := listResult{Name: "teaching-bucket", MaxKeys: maxKeys, KeyCount: end - start, IsTruncated: end < total}
		if result.IsTruncated {
			result.NextContinuationToken = fmt.Sprintf("fixture-token-%d", end)
		}
		for i := start; i < end; i++ {
			result.Contents = append(result.Contents, item{fmt.Sprintf("object-%04d", i+1), int64(i + 1), "public-etag"})
		}
		w.Header().Set("Content-Type", "application/xml")
		if err := xml.NewEncoder(w).Encode(result); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := readPage(ctx, newClient(t, server.URL), n, requestSize(n, optimized), after)
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	return result, slices.Clone(trace)
}

func TestLookahead(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		total, n, oldCalls, newCalls int
		more                         bool
	}{
		{"one-plus-one", 2, 1, 2, 1, true},
		{"terminal-lookahead", 4, 3, 2, 1, true},
		{"last-page", 3, 3, 1, 1, false},
		{"short-page", 2, 3, 1, 1, false},
		{"empty", 0, 3, 1, 1, false},
		{"upper-optimized-boundary", 1000, 999, 2, 1, true},
		{"protocol-limit", 1001, 1000, 2, 2, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old, oldTrace := runListing(t, tc.total, tc.n, false, "")
			improved, newTrace := runListing(t, tc.total, tc.n, true, "")
			if !slices.Equal(old.Items, improved.Items) || old.HasMore != improved.HasMore || old.Marker != improved.Marker {
				t.Fatalf("page mismatch: %+v / %+v", old, improved)
			}
			if len(improved.Items) != min(tc.total, tc.n) || improved.HasMore != tc.more {
				t.Fatalf("unexpected page: %+v", improved)
			}
			for i, object := range improved.Items {
				if object != (item{fmt.Sprintf("object-%04d", i+1), int64(i + 1), "public-etag"}) {
					t.Fatalf("unexpected item: %+v", object)
				}
			}
			expectedMarker := ""
			if len(improved.Items) > 0 {
				expectedMarker = improved.Items[len(improved.Items)-1].Key
			}
			if improved.Marker != expectedMarker {
				t.Fatalf("marker=%q want=%q", improved.Marker, expectedMarker)
			}
			if len(oldTrace) != tc.oldCalls || len(newTrace) != tc.newCalls {
				t.Fatalf("request count: %v / %v", oldTrace, newTrace)
			}
			if tc.oldCalls == 2 && oldTrace[1] != fmt.Sprintf("max=%d token=%q after=%q", tc.n, fmt.Sprintf("fixture-token-%d", tc.n), "") {
				t.Fatalf("SDK token not preserved: %v", oldTrace)
			}
			t.Logf("total=%d N=%d HTTP=%d->%d returned=%d hasMore=%v marker=%q", tc.total, tc.n, len(oldTrace), len(newTrace), len(improved.Items), improved.HasMore, improved.Marker)
			if tc.name == "terminal-lookahead" {
				next, nextTrace := runListing(t, tc.total, tc.n, true, improved.Marker)
				if len(next.Items) != 1 || next.Items[0].Key != "object-0004" || next.HasMore || next.Marker != "object-0004" || !slices.Equal(nextTrace, []string{`max=4 token="" after="object-0003"`}) {
					t.Fatalf("next page: %+v %v", next, nextTrace)
				}
				t.Logf("next page: returned=%s hasMore=%v trace=%v", next.Items[0].Key, next.HasMore, nextTrace)
			}
		})
	}
}

func TestCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	defer server.Close()
	client := newClient(t, server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-started:
			cancel()
		case <-ctx.Done():
		}
	}()
	result, err := readPage(ctx, client, 3, 4, "")
	<-done
	if !errors.Is(err, context.Canceled) || len(result.Items) != 0 || result.HasMore || result.Marker != "" {
		t.Fatalf("cancelled result: %+v %v", result, err)
	}
	t.Log("in-flight cancellation: context canceled, no successful partial page")
	for _, n := range []int{0, 1001} {
		if _, err := readPage(context.Background(), client, n, 1, ""); err == nil {
			t.Fatalf("accepted N=%d", n)
		}
	}
}
